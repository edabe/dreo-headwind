import { ILogObj, Logger } from 'tslog';
import { DreoAPI } from './DreoAPI';
import { SensorState } from 'incyclist-ant-plus/lib/sensors/base-sensor';
import { HeartRateSensorState } from 'incyclist-ant-plus';
import { Provider } from 'nconf';
import { DreoProfileType, DreoProfiles } from './DreoProfile';

/**
 * The HeartRateMode will control the Dreo air circulator based on heart 
 * rate data received from the ANT sensor.
 * 
 * The callback function "onDataHandler()" is called every time the HRM sends
 * a message (approximately 4 messages per second). It relies on the ANT HRM
 * profile "BeatCount" to distinguish repeating messages from repeating HR
 * readings.
 * 
 * It adopts an asymmetric smoothing approach with variable update rate based
 * on whether the heart rate is increasing or decreasing.
 * 
 * For increasing heart rates, implement quick fan speed updates. For decreasing
 * heart rates, slow fan response to allow for a cool-down effect.
 * 
 * The following configuration parameters are used:
 * - increaseSmoothFactor: the smooth factor used when an increase in the 
 *   heart rate is detected
 * - decreaseSmoothFactor: the smooth factor used when a decrease in the
 *   heart rate is detected
 * - updateFrequency: the approximate frequency in which the fan profile is
 *   updated (in milliseconds)
 * 
 * Heart rate zones are based on the Karvonen Method, which considers the
 * resting heart rate and the maximum heart rate, which are configurable:
 * user.heartrate": {
 *      "zones": [ [50,60], [60,70], [70,80], [80,90], [90,100] ],
 *      "max": 180,
 *      "rest": 55
 * }
 * https://trainingtilt.com/how-to-calculate-heart-rate-zones
 * 
 * 
 * The heartrate will be mapped to a fan "profile" (oscillating pattern)
 * and speed as follows:
 * 
 * hrZone[0] (Zone1): CENTER_0             Speed 0 - Speed 1
 * hrZone[1] (Zone2): CENTER_45            Speed 1 - Speed 3
 * hrZone[2] (Zone3): VERTICAL             Speed 3 - Speed 5
 * hrZone[3] (Zone4): VERTICAL             Speed 5 - Speed 6
 * hrZone[4] (Zone5): CENTER_45            Speed 7
 * 
 * The current temperature will influence the speed via a multiplcating factor,
 * as described in function adjustSpeed.
 */
export default class HeartRateMode {
    private logger: Logger<ILogObj>;
    private dreo: DreoAPI;
    private dreoSerialNumber: string;
    private hrZoneArray: number[][];
    private hrSmoothed: number;
    private hrIncreaseSmoothFactor: number;
    private hrDecreaseSmoothFactor: number;
    private hrLastBeatCount: number = 0;
    private hrModeUpdateFrequency: number;
    private hrModeLastUpdate: number;
    private hrProfile: DreoProfileType;
    private handlerTimeoutId: NodeJS.Timeout;
    private isAdjustDreoProfileBusy: boolean = false;
    private profileOverrideLastUpdate: number;
    private profileOverrideFrequency: number;
    private profileOverrideDuration: number;
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
        // this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, true);

        const hrconfig = nconf.get('mode.heartrate');
        // Set the smooth factor
        this.hrIncreaseSmoothFactor = hrconfig?.increaseSmoothFactor || 0.5;
        this.hrDecreaseSmoothFactor = hrconfig?.decreaseSmoothFactor || 0.1;
        // Set fan profile update frequency
        this.hrModeLastUpdate = Date.now();
        this.hrModeUpdateFrequency = hrconfig?.updateFrequency || 5000;
        // Set oscillation override frequency and duration
        this.profileOverrideFrequency = hrconfig?.oscillationFrequency || 180000;
        this.profileOverrideDuration = hrconfig?.oscillationDuration || 45000;
        this.profileOverrideLastUpdate = Date.now();

        const heartrate = nconf.get('user.heartrate');
        // Set initial smoothed heart rate to be the resting heart rate
        this.hrSmoothed = heartrate.rest;

        this.hrZoneArray = this.getHeartRateZones(heartrate.rest, heartrate.max, heartrate.zones);
        logger.info(`Heart rate details: Rest: ${heartrate.rest}, Max: ${heartrate.max}\n${JSON.stringify(this.hrZoneArray)}`);

        // Bind event handler to this in order to set the right context
        this.onDataHandler = this.onDataHandler.bind(this);
    }

    /**
     * Adjust the fan profile based on the current aggregated data.
     * 
     * The following data is considered:
     * - Heart rate zone: The heart rate zone based on the smoothed heart rate 
     *   calculated in the ANT HRM callback
     * - Temperature: The current temperature measured from the DREO sensor
     * 
     * The fan will oscillate approximately every 30 seconds to avoid heat
     * build up.
     * 
     * Adjusting the fan oscillating pattern and speed can take time.
     * The variable `isBusy` is used as a non-blocking semaphore to only allow 
     * the profile to be adjusted once at a time.
     */
    private async adjustDreoProfile(): Promise<void> {
        // Ignore call if busy
        if (this.isAdjustDreoProfileBusy) {
            this.logger.debug('Skipping DREO profile adjustment: busy');
            return;
        }
        // Sets function to 'busy'
        this.isAdjustDreoProfileBusy = true;

        // Step 1: Gather data
        const dreoState = await this.dreo.getState(this.dreoSerialNumber);
        const temperature = dreoState?.temperature as number;
        const currentSpeed = dreoState?.windlevel as number;

        // Step 2: Calculate fan speed based on current heart rate and heart rate zone
        let fanSpeed = this.getFanSpeed();

        // Step 3: Adjust fan speed according to temperature
        fanSpeed = this.adjustSpeedForTemperature(fanSpeed, temperature);

        // Step 4: Adjust fan profile, including override
        let fanProfile: DreoProfileType;

        // Step 4.1: Detect provide override
        const now = Date.now();
        if ((now - this.profileOverrideLastUpdate) >= this.profileOverrideFrequency) {            
            fanProfile = DreoProfileType.VERTICAL;
            if ((now - this.profileOverrideLastUpdate) >= (this.profileOverrideFrequency + this.profileOverrideDuration)) {
                // Reset override
                this.profileOverrideLastUpdate = now;
                this.logger.debug('Profile override ended');
            } else {
                this.logger.debug('Profile override in effect');
            }
        } else switch(fanSpeed) {
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

        // Step 6: Update fan profile
        // Only apply profile if there is a diffrence from the current setting
        this.logger.debug(`Adjust profile ${this.hrProfile} / ${fanProfile} / ${currentSpeed} / ${fanSpeed} / ${this.hrSmoothed}`);
        if (this.hrProfile !== fanProfile || currentSpeed !== fanSpeed) {
            this.hrProfile = fanProfile;
            this.logger.info(`Adjusting profile: ${this.hrProfile} with fan speed ${fanSpeed}, HR ${this.hrSmoothed} BMP and ${temperature}F`);
            await DreoProfiles[fanProfile].apply(this.dreoSerialNumber, this.dreo, fanSpeed); // 'apply' will turn the fan on if needed
        }
        this.isAdjustDreoProfileBusy = false;
    }

    /**
     * Utility function to get the fan speed based on the current heart rate
     * and the zone thresholds.
     * 
     * It uses linear interpolation within each heart rate zone to calculate
     * the fan speed based on where the current heart rate lies within the min
     * and max of the zone.
     * 
     * As a result, the speed ends up mapped HR zones as follows:
     * - Zone 1: 1-2
     * - Zone 2: 2-3
     * - Zone 3: 3-4
     * - Zone 4: 4-5
     * - Zone 5: 5-7
     */
    private getFanSpeed(): number {
        // Define the fan minimum and max speed
        const minFanSpeed = 1;
        const maxFanSpeed = 7;
        const fanSpeedRangePerZone = 1.2; // (maxFanSpeed - minFanSpeed) / this.hrZoneArray.length;

        // Get the current HR zone
        const zoneIndex = this.getHeartRateZone() - 1; // index is zone -1 (zero-based)

        // Get the min and max for the current HR zone
        const [zoneMin, zoneMax] = this.hrZoneArray[zoneIndex];

        // Get the fan speed min and max for the current zone
        const baseSpeed = minFanSpeed + (zoneIndex * fanSpeedRangePerZone);
        const zoneMinSpeed = Math.floor(baseSpeed);
        const zoneMaxSpeed = Math.floor(baseSpeed+fanSpeedRangePerZone);

        // Calculate the normalized position of the current heart rate within the zone
        const normalized = (this.hrSmoothed - zoneMin) / (zoneMax - zoneMin);

        // Calculate the fan speed within the current fan speed range (zoneMaxSpeed and zoneMinSpeed)
        const fanSpeed = Math.round(zoneMinSpeed + (normalized * (zoneMaxSpeed - zoneMinSpeed)));

        // Ensure fan speed is within limits (this is only really needed with HR is below or above zone limits)
        return Math.min(Math.max(fanSpeed, minFanSpeed), maxFanSpeed);
    }

    /**
     * Utility function to adjust a given speed based on the current temperature
     * as follows: 
     * 
     * Temp > 85F:       Increase speed by 2 (cap at 9)
     * 75F < Temp < 85F: Increase speed by 1 (cap at 9)
     * 65F < Temp < 75F: Increase speed by 0
     * Temp < 65F:       Decrease speed by 1 (cap at 1)
     *
     * @param speed The fan speed to be adjusted
     * @param temperature The current temperature
     * 
     * @returns The speed adjusted by temperature
     */
    private adjustSpeedForTemperature(speed: number, temperature: number): number {
        if (temperature > 85) {
            return Math.min(speed + 2, 9);
        } else if (temperature > 75) {
            return Math.min(speed + 1, 9);
        } else if (temperature < 65) {
            return Math.max(speed - 1, 1);
        }
        return speed;
    }

    /**
     * Utility funciton to convert the heart rate zones based on percentage of HRR to
     * heart rate beats following the Karvonen method
     * 
     * @param hrRest Rest heart rate
     * @param hrMax Max heart rate
     * @param hrZones Array of heart rate ranges (percentage of rest heart rate)
     * 
     * @returns An array of heart rate ranges (beats per minute)
     */
    private getHeartRateZones(hrRest: number, hrMax: number, hrZones: number[][]): number [][] {
        const hrReserve = hrMax - hrRest;
        return [
            [ Math.round(hrZones[0][0] / 100 * hrReserve + hrRest), Math.round(hrZones[0][1] / 100 * hrReserve + hrRest) ],
            [ Math.round(hrZones[1][0] / 100 * hrReserve + hrRest), Math.round(hrZones[1][1] / 100 * hrReserve + hrRest) ],
            [ Math.round(hrZones[2][0] / 100 * hrReserve + hrRest), Math.round(hrZones[2][1] / 100 * hrReserve + hrRest) ],
            [ Math.round(hrZones[3][0] / 100 * hrReserve + hrRest), Math.round(hrZones[3][1] / 100 * hrReserve + hrRest) ],
            [ Math.round(hrZones[4][0] / 100 * hrReserve + hrRest), Math.round(hrZones[4][1] / 100 * hrReserve + hrRest) ]
        ];
    }

    /**
     * Utility function that calculates the heart rate zone based on
     * the current heart rate.
     * 
     * It relies on the properties hrZoneArray and hrSmoothed 
     *  
     * @returns: The heart rate zone, from 1 to hrZoneArray.length
     */
    private getHeartRateZone(): number {
        let zoneIndex = -1;
        for (let i = 0; i < this.hrZoneArray.length; i++) {
            const [zoneMin, zoneMax] = this.hrZoneArray[i];
            if (this.hrSmoothed >= zoneMin && this.hrSmoothed <= zoneMax) {
                zoneIndex = i + 1;
                break;
            }
        }
        if (zoneIndex === -1)
            zoneIndex = this.hrSmoothed < this.hrZoneArray[0][0] ? 1 : this.hrZoneArray.length;

        return zoneIndex;
    }

    public async cleanup(): Promise<void> {
        // Clean up timers
        clearTimeout(this.handlerTimeoutId);
        await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        this.dreo.disconnect();
    }
 
    /**
     * The ANT+ HRM profile will send approximately 4 messages per second, which is a much
     * higher frequency than needed.
     * 
     * This callback will implement asymmetric smoothing with variable update rate based
     * on exponential moving average (EMA) to respond quickly to increases in heart rate
     * and slowly to decreases in heart rate to allow for a cool-down effect.
     * 
     * Rely on the HRM `BeatCount` property to avoid processing repeated messages.
     * 
     * @param data The ANT+ HRM data content
     */
    public onDataHandler(data: SensorState): void {
        // Optimization: Handle data based on the HR "BeatCount" property and not just on
        // every callback.
        const heartRate = (data as HeartRateSensorState).ComputedHeartRate;
        const beatCount = (data as HeartRateSensorState).BeatCount;

        // Check if HR message is repeated or corrupted
        if (isNaN(heartRate) || beatCount === this.hrLastBeatCount) {
            this.logger.debug(`onDataHandler: ignoring call: ${heartRate} / ${beatCount}`);
            return; // Ignore repeated / corrupted callback
        }

        // Update the lastBeatCount with the current value
        this.hrLastBeatCount = beatCount;

        // Apply asymmetric smoothing
        if (heartRate > this.hrSmoothed) {
            // Quick response to increase in heart rate
            this.hrSmoothed = Math.round(this.hrIncreaseSmoothFactor * heartRate + (1 - this.hrIncreaseSmoothFactor) * this.hrSmoothed);
        } else {
            // Slow response to decrease in heart rate
            this.hrSmoothed = Math.round(this.hrDecreaseSmoothFactor * heartRate + (1 - this.hrDecreaseSmoothFactor) * this.hrSmoothed);
        }

        // Update the Dreo profile every "hrModeUpdateFrequency" milliseconds 
        if (Date.now() - this.hrModeLastUpdate >= this.hrModeUpdateFrequency) {
            this.logger.debug(`BeatCount ${beatCount} / HR ${heartRate} / Smoothed HR ${this.hrSmoothed}`);
            // This callback must execute fast so it should NOT wait for the "adjustDreoProfile" function
            /* await */ this.adjustDreoProfile();
            this.hrModeLastUpdate = Date.now();
        }
    }

    public onDetectedHandler(deviceId: number): void {
        this.logger.debug('Device detected (HR): ', deviceId);
        // Detect sensor inactivity (wait for 180,000 ms - 3 minutes)
        clearTimeout(this.handlerTimeoutId);
        this.handlerTimeoutId = setTimeout(async () => {
            // Timeout without handling 'detected' callback.
            // Deactivate the HeartRateMode.
            this.logger.info(`No sensor activity (HR: ${deviceId}) - turning DREO off`);
            await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        }, 180000);
    }
}
