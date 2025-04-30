import { ILogObj, Logger } from 'tslog';
import { Provider } from 'nconf';
import { DreoAPI } from '../fan/DreoAPI';
import { DreoProfileType, DreoProfiles } from '../fan/DreoProfile';
import { PerformanceHandler, PerformanceData } from './DataHandler';
import DataSmoother from '../utils/DataSmoother';

/**
 * The PowerHeartRateMode will control the Dreo air circulator based on power
 * and heart rate data received from the ANT devices.
 * 
 * The callback function "onDataHandler()" is called multiple times per second,
 * every time the ANT driver receives an event from one of the connected devices,
 * so it is necessary to smooth the data (`smoothHeartRate` and `smoothPower`).
 * 
 * Heart rate zones are based on the Karvonen Method, which considers the
 * resting heart rate and the maximum heart rate. This can be adjusted via
 * configuration:
 * user.heartrate": {
 *      "zones": [ [50,60], [60,70], [70,80], [80,90], [90,100] ],
 *      "max": 180,
 *      "rest": 55
 * }
 * https://trainingtilt.com/how-to-calculate-heart-rate-zones
 * 
 * Power zones are based on this Trainer Road article by Sean Hurley:
 * https://www.trainerroad.com/blog/cycling-power-zones-training-zones-explained/
 * 
 * Where it defines 7 zones based on percentage of the FTP:
 * - Active recovery: < 55% FTP        (RPE 2)
 * - Endurance:         55% - 75% FTP  (RPE 6)
 * - Tempo:             76% - 87% FTP  (RPE 7)
 * - Sweet Spot:        88% - 94% FTP  (RPE 7)
 * - Threshold:         95% - 105% FTP (RPE 8)
 * - VO2 Max:          106% - 120% FTP (RPE 9)
 * - Anaerobic Capacity:    > 120% FTP (RPE 10)
 * 
 * This can be adjusted via configuration:
 * "user.power": {
 *      "ftp": 170,
 *      "zones": [ [0,54], [55,75], [76,87], [88,94], [95,105], [106,120], [121,1000] ]
 * }
 * 
 * Mapping of heart rate zones and power zones is based on relative perceived effort (RPE)
 * as follows:
 * 
 *  RPE  Power Zone  HR Zone
 *  1-2      Z1        Z1
 *  3-4      Z2        Z2
 *  5-6      Z3        Z3
 *    7      Z4        Z4
 *    8      Z5        Z4
 *    9      Z6        Z5
 *   10      Z7        Z5
 * 
 * The logic in this class was implemented with help from ChatGPT.
 */
export default class PowerHeartRateMode implements PerformanceHandler {
    private logger: Logger<ILogObj>;
    private dreo: DreoAPI;
    private dreoSerialNumber: string;
    private isDreoBusy: boolean = false;

    private stateCache = { 
        fanSetting: { speed: 0, profile: DreoProfileType.CENTER_0 },
        antData: { hrAvg: 0, pwrAvg: 0 }
    };

    // Fan profile override
    private oscillationFrequency: number;
    private oscillationLastUpdate: number;
    private oscillationDuration: number;

    // Mode update debouncing
    private modeUpdateFrequency: number;
    private modeLastUpdate: number;

    // Smoothing input data
    private smoothHeartRate: DataSmoother;
    private smoothPower: DataSmoother;

    // Heart rate and power zones
    private hrZones: number[][];
    private pwrZones: number[][];

    // Sensor weight (fan speed calculation)
    private hrWeight: number;
    private pwrWeight: number;

    constructor(logger: Logger<ILogObj>, nconf: Provider) {
        this.logger = logger;

        const dreoconfig = nconf.get('dreo.config');
        this.dreo = new DreoAPI({ 
            'logger': logger,
            'server': dreoconfig.server,
            'email': dreoconfig.email,
            'password': dreoconfig.password
        });
        this.dreoSerialNumber = dreoconfig.serialNumber;

        const modeconfig = nconf.get('handler.power_heartrate');
        // Smoothing data set
        this.smoothHeartRate = new DataSmoother(modeconfig.rollingAverage);
        this.smoothPower = new DataSmoother(modeconfig.rollingAverage);
        // HR and PWR to zone weighing
        const hrWeight = modeconfig.heartRateWeight;
        const pwrWeight = modeconfig.powerWeight;
        if (hrWeight + pwrWeight !== 1) {
            this.logger.warn('Configuration error in mode.power_heartrate: heartRateWeight + powerWeight should be 1');
            this.hrWeight = 0.5;
            this.pwrWeight = 0.5;
        }
        this.hrWeight = hrWeight;
        this.pwrWeight = pwrWeight;

        // Set fan oscillating override frequency
        this.oscillationLastUpdate = performance.now();
        this.oscillationFrequency = modeconfig.oscillationFrequency;
        this.oscillationDuration = modeconfig.oscillationDuration;

        // Set fan profile update frequency
        this.modeLastUpdate = performance.now();
        this.modeUpdateFrequency = modeconfig.updateFrequency || 5000;

        const hrconfig = nconf.get('user.heartrate');
        this.hrZones = convertHeartRateZones(hrconfig.rest, hrconfig.max, hrconfig.zones);

        const pwrconfig = nconf.get('user.power');
        this.pwrZones = convertPowerZones(pwrconfig.ftp, pwrconfig.zones);

        // Bind event handler to this in order to set the right context
        this.onPerformanceData = this.onPerformanceData.bind(this);
    }

    /**
     * Calculates the fan speed based on ANT data (heart rate and power) as well as
     * temperature.
     * 
     * The speed is calculated for heart rate and power separately, and then averaged
     * based on `hrWeight` and `pwrWeight`.
     * 
     * The fan speed to HR and PWR zones is defined as follows:
     * Fan Speed  HR Zone  PWR Zone
     *       0-1    Z1       Z1
     *       2-4    Z2       Z2
     *       5-6    Z3       Z3
     *         7    Z4       Z4
     *         8    Z4       Z5
     *         9    Z5    Z6-Z7
     * 
     * @returns The fan speed (between 1 and 9)
     */
    private calculateFanSpeedFromAnt(temperature: number | null): number {
        // Get smoothed averages
        this.stateCache.antData.hrAvg = Math.round(this.smoothHeartRate.getAverage());
        this.stateCache.antData.pwrAvg = Math.round(this.smoothPower.getAverage());

        // Determine the heart rate and power zones
        const hrZone = getZoneIndex(this.stateCache.antData.hrAvg, this.hrZones); // range 1 - 5
        const pwrZone = getZoneIndex(this.stateCache.antData.pwrAvg, this.pwrZones); // range 1 - 7

        // Heart Rate zone to fan speed
        let [minZoneValue, maxZoneValue] = this.hrZones[hrZone-1];
        const hrFanSpeed = convertFanSpeed(minZoneValue, maxZoneValue, hrZone, this.stateCache.antData.hrAvg, this.hrZones.length);

        // Power zone to fan speed
        [minZoneValue, maxZoneValue] = this.pwrZones[pwrZone-1];
        const pwrFanSpeed = convertFanSpeed(minZoneValue, maxZoneValue, pwrZone, this.stateCache.antData.pwrAvg, this.pwrZones.length);

        let fanSpeed = this.hrWeight * hrFanSpeed + this.pwrWeight * pwrFanSpeed;

        // Calculate fan speed considering also the temperature
        fanSpeed = Math.max(1, Math.min(Math.round(adjustSpeedForTemperature(fanSpeed, temperature)), 9)); // range 0 - 9 
        this.logger.debug(`Fan speed: ${JSON.stringify(this.stateCache.antData)}, speed: ${fanSpeed} based on ${hrFanSpeed}, ${pwrFanSpeed}, and ${temperature}F`);

        return fanSpeed;
    }

    /**
     * This function implements the logic to update the fan profile.
     * 
     * @param now The current time in milliseconds
     */
    private async adjustFanProfile(now: number): Promise<void> {
        // Ignore call if busy
        if (this.isDreoBusy) {
            this.logger.debug('Skipping fan adjustment: Dreo is busy');
            return;
        }

        // Sets device to 'busy'
        this.isDreoBusy = true;

        // Step 1: Gather data from fan
        const dreoState = await this.dreo.getState(this.dreoSerialNumber);
        const isDreoOn = dreoState?.poweron || false;
        const temperature = isDreoOn ? dreoState?.temperature as number : null;
        const currentSpeed = isDreoOn ? dreoState?.windlevel as number : null;

        // Step 2: Calculate speed based on ANT sensor data and temperature
        const calculatedSpeed = this.calculateFanSpeedFromAnt(temperature);
                
        // Step 4: Ajust fan profile (including oscillation override)
        let fanProfile: DreoProfileType;
        // Detect oscillation override
        if ((now - this.oscillationLastUpdate) >= this.oscillationFrequency) {
            fanProfile = DreoProfileType.VERTICAL;
            if ((now - this.oscillationLastUpdate) >= (this.oscillationFrequency + this.oscillationDuration)) {
                // Reset override
                this.oscillationLastUpdate = now;
                this.logger.debug('Oscillation override ended');
            } else {
                this.logger.debug('Oscillation override in effect');
            }
        } else switch(calculatedSpeed) { // Adjust profile based on fan speed
            case 0:
            case 1:
                // Fan profile set to "feet"
                fanProfile = DreoProfileType.CENTER_0;
                break;
            case 2:
            case 3:
                // Fan profile set to "torso"
                fanProfile = DreoProfileType.CENTER_30;
                break;
            case 4:
            case 5:
            case 6:
            case 7:
                // Fan profile set to "face"
                fanProfile = DreoProfileType.CENTER_45;
                break;
            default:
                // Fan profile set to oscillate
                fanProfile = DreoProfileType.VERTICAL;
        }
        const cacheInfo = `cache: [${JSON.stringify(this.stateCache.fanSetting.profile)}, ${this.stateCache.fanSetting.speed}]`;
        const newInfo = `new: [${JSON.stringify(fanProfile)}, ${calculatedSpeed}]`    

        // Step 5: Detect fan settings change
        // Only apply profile if there is a diffrence from the current setting
        if (this.stateCache.fanSetting.profile === fanProfile && currentSpeed === calculatedSpeed) {
            // Skipping profile update - nothing to do 
            this.logger.debug(`Skipping adjust profile: ${JSON.stringify(this.stateCache.fanSetting)}`);
        } else {
            // Either profile or fan speed changed - adjusting profile
            // 1. Update state cache
            this.stateCache.fanSetting.profile = fanProfile;
            this.stateCache.fanSetting.speed = calculatedSpeed;
            this.logger.debug(`Adjusting cache: ${calculatedSpeed}, ${fanProfile}`);
            // 2. Turn on fan if needed
            if (!isDreoOn) {
                this.logger.debug('Fan needs to be turned on');
                await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, true);
            }
            // 3. Apply profile (send command to fan)
            this.logger.info(`Adjust fan profile ${cacheInfo} ${newInfo}, temp: ${temperature}F`);
            await DreoProfiles[fanProfile].apply(this.dreoSerialNumber, this.dreo, calculatedSpeed); // 'apply' will NOT turn the fan on if needed
        }

        // Free up the device
        this.isDreoBusy = false;
    }

    /**
     * This function will be called multiple times per second, every time the ANT+
     * driver receives an event from a connected device.
     * 
     * @param data The ANT+ data content
     */
    public onPerformanceData(data: PerformanceData): void {
        if (!data.heartRate || !data.averagePower) {
            // All data must be present; otherwise discard callback
            this.logger.debug(`Discarding data handler: ${data.heartRate} / ${data.averagePower}`);
            return;
        }

        // Add new data into the smoother
        this.smoothHeartRate.add(data.heartRate as number);
        this.smoothPower.add(data.averagePower as number);

        const now = performance.now();
        if (now - this.modeLastUpdate >= this.modeUpdateFrequency) {
            // This callback must execute fast so it should not wait for 'adjustFanProfile'
            // The 'isDreoBusy' ensures that the function is not called multiple times
            /* await */ this.adjustFanProfile(now);
            this.modeLastUpdate = now;
        }
    } 

    /**
     * Cleanup function.
     */
    public async cleanUp(): Promise<void> {
        // Clean up timers
        this.logger.info(`Cleaning up PowerHeartRateMode...`);
        // set `modeLastUpdate` to avoid any calls to `adjustFanProfile` after cleanup
        this.modeLastUpdate = performance.now();
        await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        await this.dreo.disconnect();
    }
}

/**
 * Utility funciton to convert the heart rate zones based on percentage of HRR to
 * heart rate beats following the Karvonen method
 * 
 * @param rest Rest heart rate
 * @param max Max heart rate
 * @param zones Array of heart rate ranges (percentage of rest heart rate)
 * 
 * @returns An array of heart rate ranges (beats per minute)
 */
function convertHeartRateZones(rest: number, max: number, zones: number[][]): number[][] {
    // The returned array must have continuous numbers otherwise `getZoneIndex` will fail
    const hrReserve = max - rest;
    let minCache = Math.round(zones[0][0] / 100 * hrReserve + rest);
    return zones.map((entry) => {
        const newMin = minCache;
        const newMax = Math.round(entry[1] / 100 * hrReserve + rest);
        minCache = newMax;
        return [ newMin, newMax ];
    });
}

/**
 * Utility function to convert the power zones based on percentage of FTP to watts
 * based on FTP
 * 
 * @param ftp: Functional threshold power
 * @param zones: Array of power ranges (percentage of FTP)
 * 
 * @returns An array of power ranges (watts)
 */
function convertPowerZones(ftp: number, zones: number[][]): number[][] {
    // The returned array must have continuous numbers otherwise `getZoneIndex` will fail
    let minCache = Math.round(zones[0][0] * ftp / 100);
    return zones.map((entry) => {
        const newMin = minCache;
        const newMax = Math.round(entry[1] * ftp / 100);
        minCache = newMax;
        return [ newMin, newMax ];
    });
}

/**
 * Utility function to identify the index of a given zone array based on the provided
 * argument. It can be applied to both heart rate zone as well as power zone arrays
 * 
 * @param value The provided heart rate or power value
 * @param zones The array of arrays containing the zone mapping
 * 
 * @returns The corresponding zone index
 */
function getZoneIndex(value: number, zones: number[][]): number {
    if (value < zones[0][0]) return 1;
    if (value >= zones[zones.length-1][1]) return zones.length;
    return zones.findIndex(([min,max]) => value >= min && value <= max) + 1;
}

/**
 * Utility function to adjust a given speed based on the current temperature.
 * This is based on a quadratic function that is pinned to the following data
 * points:
 * 
 * Temp: 65F -> Fan speed: -1
 * Temp: 75F -> Fan speed:  0
 * Temp: 85F -> Fan speed: +1
 * 
 * The resulting equation is: 1/200 * T^2 - 3/5 * T + 135/8
 * Which can be simplified to 0.005 * T^2 - 0.6 * T + 16.875
 *
 * @param speed The fan speed to be adjusted
 * @param temperature The current temperature
 * 
 * @returns The speed adjusted by temperature
 */
function adjustSpeedForTemperature(speed: number, temperature: number | null): number {
    if (!temperature) return speed;
    return speed += 0.005*Math.pow(temperature, 2) - 0.6*temperature + 16.875
}

/**
 * Utility function to calculate the fan speed based on the given zone ranges, zone index, zone value
 * and the size of the zone.
 * 
 * For instance, consider the heart rate zones, which is comprised of 5 zones (%HR converted to BPM):
 * Zone     Z1      Z2       Z3       Z4      Z5
 * BPM    < 130  130-143  143-155  155-168  > 168
 * Speed   0-1     2-4      5-6      7-8      9   
 * 
 * If the current heart rate is 136 BPM, this function will take:
 * - `minZoneValue` = 130
 * - `maxZoneValue` = 143
 * - `zoneIndex` = 2
 * - `zoneValue` = 136
 * - `zoneLength` = 5
 * 
 * And it will return `3` as the corresponding fan speed for that zone / heart rate.
 * 
 * @param minZoneValue The minimum value for the zone
 * @param maxZoneValue The maximum value for the zone
 * @param zoneIndex The zone index for the given value
 * @param zoneValue The current value (BPM or Watts)
 * @param zoneSize The length of the zone (5 for HR, 7 for Power)
 * @returns 
 */
function convertFanSpeed(minZoneValue: number, maxZoneValue: number, zoneIndex: number, zoneValue: number, zoneSize: number): number {
    // Define the fan minimum and max speed
    const minFanSpeed = 0;
    const maxFanSpeed = 9;
    const fanSpeedRangePerZone = (maxFanSpeed - minFanSpeed) / zoneSize; // (maxFanSpeed - minFanSpeed) / this.hrZoneArray.length;

    // Get the fan speed min and max for the current zone
    const baseSpeed = minFanSpeed + (zoneIndex * fanSpeedRangePerZone);
    const zoneMaxSpeed = Math.floor(baseSpeed+fanSpeedRangePerZone);
    const zoneMinSpeed = Math.floor(baseSpeed);

    // Calculate the normalized position of the current heart rate within the zone
    const normalized = (zoneValue - minZoneValue) / (maxZoneValue - minZoneValue);

    // Calculate the fan speed within the current fan speed range (zoneMaxSpeed and zoneMinSpeed)
    const fanSpeed = Math.round(zoneMinSpeed + (normalized * (zoneMaxSpeed - zoneMinSpeed)));

    // Ensure fan speed is within limits (this is only really needed with HR is below or above zone limits)
    return Math.min(Math.max(fanSpeed, minFanSpeed), maxFanSpeed);
}