import { AntDevice, BicyclePowerSensor, BicyclePowerSensorState, CadenceSensor, CadenceSensorState, Channel, FitnessEquipmentSensor, HeartRateSensor, HeartRateSensorState, ISensor } from 'incyclist-ant-plus';
import { SensorState } from 'incyclist-ant-plus/lib/sensors/base-sensor';
import { Provider } from 'nconf';
import { ILogObj, Logger } from 'tslog';
import { EventData, PerformanceData, PerformanceHandler } from '../handler/PerformanceHandler';
import PerformanceMetrics from '../metrics/PerformanceMetrics';
import PowerHeartRateMode from '../handler/PowerHeartRateMode';

/**
 * Extends DataType with ANT specific properties
 */
type AntDataType = EventData & {
    beatCount: number;
    powerCount: number;
    cadenceCount: number;
}

/**
 * Implements the ANT connection logic.
 */
export default class AntConnection {
    // Logger instance
    protected logger: Logger<ILogObj>;

    // Ant initialization
    // Windows might need a different initialization call - see 'fitness-equipment-advanced.js'
    private ant: AntDevice;

    // Sensor allowlist 
    private allowedDevices: Record<string,number>;

    // Track active devices based on elapsed time
    private activeProfiles = new Map<string, NodeJS.Timeout | undefined>();

    // The Data Handler to be used
    private performanceHandlers: PerformanceHandler[];

    // The cached data type
    private cachedDataType: AntDataType = { beatCount: 0, powerCount: 0, cadenceCount: 0 };

    // The performance metrics
    private performanceMetrics: PerformanceMetrics;

    /**
     * Class constructor
     * @param logger Logger instance
     * @param nconf  Configuration instance
     */
    constructor(logger: Logger<ILogObj>, nconf: Provider) {
        this.logger = logger;
        this.allowedDevices = nconf.get('ant.allowed_devices');

        // Performance metrics
        this.performanceMetrics = new PerformanceMetrics(logger, nconf);

        // Fan handler
        const fanHandler = new PowerHeartRateMode(logger, nconf);
        // Data handler array - performance metric benefits from being first
        this.performanceHandlers = [ fanHandler ];

        // Bind event handler to this in order to set the right context
        this.onDetected = this.onDetected.bind(this);
        this.onData = this.onData.bind(this);
        this.onAppExit = this.onAppExit.bind(this);

        // Configure process to exit app cleanly
        process.on('SIGINT',  async () => await this.onAppExit()); // CTRL+C
        process.on('SIGQUIT', async () => await this.onAppExit()); // Keyboard quit
        process.on('SIGTERM', async () => await this.onAppExit()); // `kill` command
        process.on('unhandledRejection', async (err: Error) => await this.onAppExit(err)); // Unhandled rejection at top-level
    }

    // Convenient sleeping function
    protected sleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Initiates the ANT driver (USB dongle) and returns the ANT channel for connection.
     * If it can't initialize the ANT driver, it will retry indefinitely.
     * 
     * @returns An instace of Channel
     */
    private async getChannel(): Promise<Channel> {
        // Open the ant stick
        let retries = 10;
        let isOpen = false;
        do {
            this.ant = new AntDevice({ startupTimeout: 2000 });
            isOpen = await this.ant.open() as boolean;
            if (retries === 0) {
                const error = 'Failed to open ANT stick after multiple retries.' 
                this.logger.error(error);
                throw new Error(error);
            }
            if (!isOpen) {
                this.logger.info('Unable to open ANT stick; re-trying...');
                retries --;
                await this.ant.close();
                await this.sleep(5000);
            }
        }
        while(!isOpen);
        
        // Retrieve the channel
        return this.ant.getChannel() as Channel;
    }

    /**
     * Implements the logic to attach sensors for specific ANT devices supported in this app.
     * 
     * @param channel The Channel to connect sensors to.
     */
    private async setupSensors(channel: Channel): Promise<void> {
        for (const [key, value] of Object.entries(this.allowedDevices)) {
            switch(key) {
                case 'pwr': 
                    this.logger.info('Initializing power meter sensor for device ', value);
                    channel.attach(new BicyclePowerSensor(value) as ISensor);
                    break;
                case 'fe':
                    this.logger.info('Initializing fitness equimenent sensor for device ', value);
                    channel.attach(new FitnessEquipmentSensor(value) as ISensor);
                    break;
                case 'cad':
                    this.logger.info('Initializing cadence sensor for device ', value);
                    channel.attach(new CadenceSensor(value) as ISensor);
                    break;
                case 'hr':
                    this.logger.info('Initializing heart rate sensor for device ', value);
                    channel.attach(new HeartRateSensor(value) as ISensor);
                    break;
            }
        }
    }

    /**
     * Implements the handler for "detected" events.
     * The ANT driver will repeatedly emit "detected" events for connected ANT devices.
     * 
     * @param profile The ANT profile of the device
     * @param deviceId The id of the device
     */
    protected onDetected(profile: string, deviceId: number): void {
        switch(profile) {
            case 'PWR':
                break;
            case 'FE':
                break;
            case 'CAD':
                break;
            case 'HR':
                break;
        }
        // Start logging session
        // if (this.shouldHandleData())
        //     this.antLogger.startSession();

        // Detect sensor activity (hardcoded to 60s)
        this.logger.debug(`Device detected: ${deviceId} (${profile})`);
        clearTimeout(this.activeProfiles.get(profile));
        this.activeProfiles.set(profile, setTimeout(() => {
            // No sensor activity.
            this.logger.info(`No device activity: ${deviceId} (${profile})`);
            
            this.activeProfiles.set(profile, undefined);
            this.dataHandlerStandBy();
        }, 60000));
    }
    
    /**
     * Implements the handler for "data" events.
     * The ANT driver will repeatedly emit "data" events for connected ANT devices, even if
     * the device data has not changed.
     * 
     * @param profile The ANT profile of the device
     * @param deviceId The id of the device
     * @param data The data payload from the device
     */
    protected onData(profile: string, deviceId: number, data: SensorState): void {
        switch(profile) {
            case 'PWR': {
                // Optimization: Handle data based on power and event count.
                const power = (data as BicyclePowerSensorState)?.Power as number;
                const eventCount = (data as BicyclePowerSensorState)._0x10_EventCount as number;

                // Check if power message is repeated or corrupted
                if (isNaN(power) || eventCount === this.cachedDataType.powerCount) {
                    this.logger.debug(`Ignoring Power data handler: ${power} / ${eventCount}`);
                } else {
                    this.cachedDataType.powerCount = eventCount;
                    this.cachedDataType.averagePower = power;
                }
                break;
            }           
            case 'FE':
                break;
            case 'CAD': {
                // Optimization: Handle data based on the cadence and revolution count.
                const cadence = (data as CadenceSensorState).CalculatedCadence;
                const eventCount = (data as CadenceSensorState).CumulativeCadenceRevolutionCount;

                // Check if cadence message is repeated or corrupted
                if (isNaN(cadence) || eventCount === this.cachedDataType.cadenceCount) {
                    this.logger.debug(`Ignoring Cadence data handler: ${cadence} / ${eventCount}`);
                } else {
                    this.cachedDataType.cadenceCount = eventCount;
                    this.cachedDataType.cadence = cadence;
                }
                break;
            }
            case 'HR': {
                // Optimization: Handle data based on heart rate and beat count.
                const heartRate = (data as HeartRateSensorState).ComputedHeartRate;
                const eventCount = (data as HeartRateSensorState).BeatCount;

                // Check if HR message is repeated or corrupted
                if (isNaN(heartRate) || eventCount === this.cachedDataType.beatCount) {
                    this.logger.debug(`Ignoring HR data handler: ${heartRate} / ${eventCount}`);
                } else {
                    this.cachedDataType.beatCount = eventCount;
                    this.cachedDataType.heartRate = heartRate;
                }
                break;
            }
        }
        // Log Ant activity
        // this.antLogger.logSensorEvent(profile, deviceId, data);

        // Only process data if the PWR and HR sensors are active 
        if (this.shouldHandleData()) {
            this.performanceMetrics.onDataHandler(this.cachedDataType);
//            this.dataHandlers.forEach(handler => handler.onDataHandler(this.cachedDataType));
        }
    }

    /**
     * Implements the logic to switch the data handler into standby mode
     */
    private async dataHandlerStandBy(): Promise<void> {
        // Clean up data handler if at least one of the detected devices is inactive
        if (!this.shouldHandleData()) {
            // End logging session
            // await this.antLogger.endSession();
            this.logger.info('Data handler switching to standby');
//            this.dataHandlers.forEach(async (handler) => await handler.cleanUp());
        }
    }

    /**
     * Checks if all ANT devices are active.
     * 
     * @returns true if and only if all relevant ANT devices are active.
     */
    private shouldHandleData(): boolean {
        // Should only handle data when both PWR and HR devices are active
        return this.activeProfiles.get('PWR') !== undefined && this.activeProfiles.get('HR') !== undefined;
    }

    /**
     * Simplifies testing by encapsulating the process.exit
     * 
     * @param exitCode The exit code to be passed on exit
     * @returns never
     */
    private processExit(exitCode: number = -1): never {
        process.exit(exitCode);
    }

    /**
     * Clean up for app exit
     */
    protected async onAppExit(error?: Error) {
        const timerId = setTimeout(() => { throw new Error('Error: timeout trying to exit the app')}, 20000);
        let retCode = 0;
        try {
            if (error) {
                this.logger.info('Application exiting due to error:', error);
                retCode = -1;
            }
            else {
                this.logger.info('Exiting application');
            }
            this.logger.info('Closing ANT stick');
            await this.ant?.close();
            for (const [key, value] of this.activeProfiles) {
                this.logger.info('Cleaning up active profile: ', key);
                clearTimeout(value);
            }
        } catch (err) {
            clearTimeout(timerId);
            this.logger.error(err);
            retCode = -1;
        } finally {
            this.logger.info('Cleaning up dataHandlers');
 //           this.dataHandlers.forEach(async (handler) => await handler.cleanUp());
            this.logger.info('Closing ANT logger');
            // await this.antLogger.endSession();
            clearTimeout(timerId);
            await this.sleep(5000);
            this.processExit(retCode);
        }
    }

    /**
     * Initialize and start the application
     */
    public async startApp() {
        const channel = await this.getChannel();
        await this.setupSensors(channel);
    
        channel.on('detected', this.onDetected);
        channel.on('data', this.onData);
    
        await channel.startScanner();
    }
}