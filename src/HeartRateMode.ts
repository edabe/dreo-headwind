import { ILogObj, Logger } from "tslog";
import { DreoAPI } from "./DreoAPI";
import { SensorState } from "incyclist-ant-plus/lib/sensors/base-sensor";
import { HeartRateSensorState } from "incyclist-ant-plus";
import { Provider } from "nconf";
import { DreoProfileType, DreoProfiles } from "./DreoProfile";

/**
 * The HeartRateMode will control the Dreo air circulator based on heart 
 * rate data received from the ANT sensor.
 * 
 * The ANT sensor will transmit approximately 4 messages per second; this
 * implementation will store the heartrate data into an array of a
 * configurable size ('mode.heartrate[sampleSize]') and once the array
 * is full, it will compute the average heartrate and match to a fan
 * "profile".
 * 
 * The heartrate will be mapped to a fan "profile" (oscillating pattern)
 * and speed as follows:
 * 
 * hrZone[0] (Zone1): CENTER_0             Speed 1
 * hrZone[1] (Zone2): CENTER_45            Speed 1 - Speed 2
 * hrZone[2] (Zone3): CENTER_45            Speed 2 - Speed 3
 * hrZone[3] (Zone4): VERTICAL             Speed 3 - Speed 4
 * hrZone[4] (Zone5): VERTICAL             Speed 4 - Speed 6 
 */
export default class HeartRateMode {
    private logger: Logger<ILogObj>;
    private dreo: DreoAPI;
    private dreoSerialNumber: string;
    private hrZone: number[];
    private hrHistory: number[];
    private profileCurrent: DreoProfileType;
    private timeoutId: NodeJS.Timeout;
    private index: number = 0;
    private isBusy: boolean = false;
    constructor(logger: Logger<ILogObj>, nconf: Provider) {
        this.logger = logger;

        const hrconfig = nconf.get('mode.heartrate');
        this.hrHistory = new Array(hrconfig?.sampleSize | 30);

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
        this.hrZone = [
            heartrate.zones[0][0] * heartrate.max / 100,
            heartrate.zones[1][0] * heartrate.max / 100,
            heartrate.zones[2][0] * heartrate.max / 100,
            heartrate.zones[3][0] * heartrate.max / 100,
            heartrate.zones[4][0] * heartrate.max / 100
        ];
        logger.info('Heart rate zones: ', this.hrZone);

        // Bind event handler to this in order to set the right context
        this.onDataHandler = this.onDataHandler.bind(this);
    }

    private async applyProfile(profileType: DreoProfileType, speed: number): Promise<void> {
        if (this.profileCurrent !== profileType) {
        await DreoProfiles[profileType].apply(this.dreoSerialNumber, this.dreo);
            this.profileCurrent = profileType;
        }
        await this.dreo.airCirculatorSpeed(this.dreoSerialNumber, speed);
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
            if (avgHr > this.hrZone[4]) {
                // HR is Zone 5
                this.logger.info('Adjusting DREO profile to Zone 5', avgHr);
                // Adjust speed based on current state
                const speed = dreoState?.windlevel === 4 ? 5 : dreoState?.windlevel === 5 ? 6 : 4;
                await this.applyProfile(DreoProfileType.VERTICAL, speed);
            }
            else if (avgHr > this.hrZone[3]) {
                // HR is Zone 4
                this.logger.info('Adjusting DREO profile to Zone 4', avgHr);
                // Adjust speed based on current state
                const speed = dreoState?.windlevel === 3 ? 4 : 3;
                await this.applyProfile(DreoProfileType.VERTICAL, speed);
            }
            else if (avgHr > this.hrZone[2]) {
                // HR is Zone 3
                this.logger.info('Adjusting DREO profile to Zone 3', avgHr);
                // Adjust speed based on current state
                const speed = dreoState?.windlevel === 2 ? 3 : 2;
                await this.applyProfile(DreoProfileType.CENTER_45, speed);
            }
            else if (avgHr > this.hrZone[1]) {
                // HR is Zone 2
                this.logger.info('Adjusting DREO profile to Zone 2', avgHr);
                // Adjust speed based on current state
                const speed = dreoState?.windlevel === 1 ? 2 : 1;
                await this.applyProfile(DreoProfileType.CENTER_45, speed);
            }
            else if (avgHr > this.hrZone[0]) {
                // HR is Zone 1 
                this.logger.info('Adjusting DREO profile to Zone 1', avgHr);
                await this.applyProfile(DreoProfileType.CENTER_0, 1);
            }
            else {
                // Turn DREO off
                this.logger.info('Adjusting DREO profile to Zone 0', avgHr, dreoState?.poweron);
                if (dreoState?.poweron) {
                    await this.dreo.airCirculatorSpeed(this.dreoSerialNumber, 1);
                    await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
                }
            }
            this.isBusy = false;
        }
        else this.logger.info('Skipping DREO profile adjustment: busy');
    }

    public async cleanup(): Promise<void> {
        // Clean up timers
        clearTimeout(this.timeoutId);
        await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        this.dreo.disconnect();
    }
 
    public onDataHandler(data: SensorState): void {
        const heartRate = (data as HeartRateSensorState).ComputedHeartRate;
        if (!isNaN(heartRate)) {
            this.hrHistory[this.index++] = heartRate;
            if (this.index === this.hrHistory.length) {
                // Heartrate sample gathered; adjust Dreo profile
                // This should NOT wait for the adjustDreoProfile function
                this.adjustDreoProfile();
                this.index = 0;
            }
        }
    }

    public onDetectedHandler(): void {
        // Detect sensor inactivity (wait for 180,000 ms - 3 minutes)
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(async () => {
            // Timeout without handling 'detected' callback.
            // Deactivate the HeartRateMode.
            this.logger.info('No sensor activity - turning DREO off');
            await this.dreo.airCirculatorPowerOn(this.dreoSerialNumber, false);
        }, 180000);
    }
}