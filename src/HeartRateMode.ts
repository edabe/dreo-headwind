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
 * The ANT sensor will transmit approximately 4 messages per second; this
 * implementation will only process heart rate based on the ANT 'BeatCount'
 * property; an array of configurable size ('mode.heartrate[sampleSize]') 
 * is used to store heart rate data to be averaged and matched to a fan
 * "profile".
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
 */
export default class HeartRateMode {
    private logger: Logger<ILogObj>;
    private dreo: DreoAPI;
    private dreoSerialNumber: string;
    private hrZone: number[][];
    private hrHistory: number[]; 
    private currentProfile: DreoProfileType;
    private currentSpeed: number = 0;
    private timeoutId: NodeJS.Timeout;
    private index: number = 0;
    private isBusy: boolean = false;
    private beatCount: number = 0;
    constructor(logger: Logger<ILogObj>, nconf: Provider) {
        this.logger = logger;

        const hrconfig = nconf.get('mode.heartrate');
        // NOTE: hrHistory is based on the ANT+ HR "BeatCount" so the
        //       array lenth will define how fast the fan will respond
        //       to heart changes.
        this.hrHistory = new Array(hrconfig?.sampleSize | (256/8));

        const dreoconfig = nconf.get('dreo.config');
        this.dreo = new DreoAPI({ 
            'logger': logger,
            'server': dreoconfig.server,
            'email': dreoconfig.email,
            'password': dreoconfig.password
        });
        this.dreoSerialNumber = dreoconfig.serialNumber;
        // this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, true);

        const heartrate = nconf.get('user.heartrate');
        this.hrZone = this.getHeartRateZones(heartrate.rest, heartrate.max, heartrate.zones);
        logger.info(`Heart rate details: Rest: ${heartrate.rest}, Max: ${heartrate.max}\n${JSON.stringify(this.hrZone)}`);

        // Bind event handler to this in order to set the right context
        this.onDataHandler = this.onDataHandler.bind(this);
    }

    private async applyProfile(profileType: DreoProfileType, speed: number): Promise<void> {
        // Only apply profile if there is a diffrence from the current setting
        if (this.currentProfile !== profileType || this.currentSpeed !== speed) {
            await DreoProfiles[profileType].apply(this.dreoSerialNumber, this.dreo);
            await this.dreo.airCirculatorSpeed(this.dreoSerialNumber, speed);
            this.currentProfile = profileType;
            this.currentSpeed = speed;
        }
    }

    /**
     * Adjusting the fan oscillating pattern and speed can take time.
     * The variable `isBusy` is used as a non-blocking semaphore to only allow 
     * the profile to be adjusted once at a time.
     */
    private async adjustDreoProfile(): Promise<void> {
        if (!this.isBusy) { // ignore command if other thread is still adjusting a profile
            this.isBusy = true;
            const dreoState = await this.dreo.getState(this.dreoSerialNumber);
            const avgHr = this.hrHistory.reduce((acc, value) => { return acc + value }) / this.hrHistory.length;
            switch(this.getHeartRateZone(avgHr)) {
                case 1: {
                    // HR is Zone 1 
                    // Adjust speed based on current hr and zone (range [0..1])
                    const speed = 0 + this.getSpeedOffset(this.hrZone[0][0], this.hrZone[0][1], avgHr, 1);
                    this.logger.info('Adjusting DREO profile to Zone 1', avgHr.toFixed(2), speed);
                    if (speed == 0) {
                        await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
                    } else {
                        await this.applyProfile(DreoProfileType.CENTER_0, speed);
                    }
                    break;
                }
                case 2: {
                    // HR is Zone 2
                    // Adjust speed based on current hr and zone (range [1..3])
                    const speed = 1 + this.getSpeedOffset(this.hrZone[1][0], this.hrZone[1][1], avgHr, 2);
                    this.logger.info('Adjusting DREO profile to Zone 2', avgHr.toFixed(2), speed);
                    await this.applyProfile(DreoProfileType.CENTER_45, speed);
                    break;
                }
                case 3: {
                    // HR is Zone 3
                    // Adjust speed based on current hr and zone (range [3..5])
                    const speed = 3 + this.getSpeedOffset(this.hrZone[2][0], this.hrZone[2][1], avgHr, 2);
                    this.logger.info('Adjusting DREO profile to Zone 3', avgHr.toFixed(2), speed);
                    await this.applyProfile(DreoProfileType.VERTICAL, speed);
                    break;
                }
                case 4: {
                    // HR is Zone 4
                    // Adjust speed based on current hr and zone (range [5..6])
                    const speed = 5 + this.getSpeedOffset(this.hrZone[3][0], this.hrZone[3][1], avgHr, 1);
                    this.logger.info('Adjusting DREO profile to Zone 4', avgHr.toFixed(2), speed);
                    await this.applyProfile(DreoProfileType.VERTICAL, speed);
                    break;
                }
                case 5: {
                    // HR is Zone 5
                    // Adjust speed based on current hr and zone (range [7..7])
                    const speed = 7;
                    this.logger.info('Adjusting DREO profile to Zone 5', avgHr.toFixed(2), speed);
                    await this.applyProfile(DreoProfileType.CENTER_45, speed);
                    break;
                }
                default: {
                    // Turn DREO off
                    this.logger.info('Adjusting DREO profile to Zone 0', avgHr.toFixed(2), dreoState?.poweron);
                    if (dreoState?.poweron) {
                        await this.dreo.airCirculatorSpeed(this.dreoSerialNumber, 1);
                        await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
                    }
                }
            }
            this.isBusy = false;
        }
        else this.logger.info('Skipping DREO profile adjustment: busy');
    }
    
    /**
     * Utility function to compute the speed offset to be applied based on the current
     * heartrate in relation to the corresponding heartrate zone.
     * 
     * @param hrZoneMin The heartrate zone minimum value
     * @param hrZoneMax The heartrate zone maximum value
     * @param heartrate The current heartrate
     * @param split The number of splits to factor in 
     * 
     * @returns The speed offset within the range [0..split]
     */
    private getSpeedOffset(hrZoneMin: number, hrZoneMax: number, heartrate: number, split: number): number {
        if (split < 1) return 0;
        const range = hrZoneMax - hrZoneMin;
        if (split > (range)) split = range;

        const fraction = Math.ceil(((hrZoneMax) - hrZoneMin) / (split + 1));
        return Math.min(Math.floor((heartrate - hrZoneMin) / fraction), split);
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
    private getHeartRateZones(hrRest: number, hrMax: number, hrZones: number[][]) {
        const hrReserve = hrMax - hrRest;
        return [
            [ hrZones[0][0] / 100 * hrReserve + hrRest, hrZones[0][1] / 100 * hrReserve + hrRest ],
            [ hrZones[1][0] / 100 * hrReserve + hrRest, hrZones[1][1] / 100 * hrReserve + hrRest ],
            [ hrZones[2][0] / 100 * hrReserve + hrRest, hrZones[2][1] / 100 * hrReserve + hrRest ],
            [ hrZones[3][0] / 100 * hrReserve + hrRest, hrZones[3][1] / 100 * hrReserve + hrRest ],
            [ hrZones[4][0] / 100 * hrReserve + hrRest, hrZones[4][1] / 100 * hrReserve + hrRest ]
        ];
    }

    /**
     * Utility function to return the heart rate zone based on the given
     * heart rate average, based on the hrZones property
     * 
     * @param hrAverage Heart rate average
     * 
     * @returns: The heart rate zone, from 0 to hrZones.length
     */
    private getHeartRateZone(hrAverage: number) {
        // Boundaries
        const hrMax = this.hrZone[this.hrZone.length-1][1];
        if (hrAverage >= hrMax) return this.hrZone.length;
        const hrMin = this.hrZone[0][0];
        if (hrAverage <= hrMin) return 0;

        let zone = 0;
        while (zone < this.hrZone.length) {
            if (hrAverage < this.hrZone[zone][1]) break;
            zone++
        }
        return zone + 1;
    }

    public async cleanup(): Promise<void> {
        // Clean up timers
        clearTimeout(this.timeoutId);
        await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        this.dreo.disconnect();
    }
 
    public onDataHandler(data: SensorState): void {
        // Optimization: Handle data based on the HR "BeatCount" property and not just on
        // every callback.
        const heartRate = (data as HeartRateSensorState).ComputedHeartRate;
        const beatCount = (data as HeartRateSensorState).BeatCount;
        if (!isNaN(heartRate) && (beatCount !== this.beatCount)) {
            this.beatCount = beatCount;
            this.hrHistory[this.index++] = heartRate;
            this.logger.debug(`Heart rate (${heartRate} / ${(data as HeartRateSensorState).BeatCount}). Index: ${this.index}; history: `, this.hrHistory.toString());
            if (this.index === this.hrHistory.length) {
                // Heartrate sample gathered; adjust Dreo profile
                // This should NOT wait for the adjustDreoProfile function
                // (the handler has to execute fast)
                /* await */ this.adjustDreoProfile();
                this.index = 0;
            }
        }
    }

    public onDetectedHandler(deviceId: number): void {
        this.logger.debug('Device detected (HR): ', deviceId);
        // Detect sensor inactivity (wait for 180,000 ms - 3 minutes)
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(async () => {
            // Timeout without handling 'detected' callback.
            // Deactivate the HeartRateMode.
            this.logger.info(`No sensor activity (HR: ${deviceId}) - turning DREO off`);
            await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        }, 180000);
    }
}
