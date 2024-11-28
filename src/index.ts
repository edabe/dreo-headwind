import { Logger, ILogObj } from 'tslog';
import nconf from 'nconf';
import { AntDevice, Channel, HeartRateSensor, BicyclePowerSensor, FitnessEquipmentSensor, CadenceSensor, ISensor  } from 'incyclist-ant-plus';
import { SensorState } from 'incyclist-ant-plus/lib/sensors/base-sensor';
import HeartRateMode from './HeartRateMode';

// Initialize logger
const logger = new Logger<ILogObj>({ 
    name: 'dreo-headwind-logger',
    minLevel: 3
});

// Load configuration file
nconf.file({ file: `${process.cwd()}/config/config.json` }).argv().env();

/**
 * The main file for the smart fan application.
 * 
 */
export default class App {
    // Active device profiles
    private profiles = new Map<string, number>();
    // Active profile timeout (milliseconds)
    private profileTimeout = 2000;

    // HeartRate smart mode
    private heartRateMode: HeartRateMode;

    // Ant initialization
    // Windows might need a different initialization call - see 'fitness-equipment-advanced.js'
    private ant: AntDevice;

    // Private constructor
    private constructor() {
        // Bind event handler to this in order to set the right context
        this.onDetected = this.onDetected.bind(this);
        this.onData = this.onData.bind(this);
        this.onAppExit = this.onAppExit.bind(this);
    }

    // Convenient sleeping function
    private sleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Retrieve the ant channel
    private async getChannel(): Promise<Channel> {
        // Open the ant stick
        let retries = 10;
        let isOpen = false;
        do {
            this.ant = new AntDevice({ startupTimeout: 2000 });
            isOpen = await this.ant.open() as boolean;
            if (retries === 0) {
                const error = 'Failed to open ANT stick after multiple retries.' 
                logger.error(error);
                throw new Error(error);
            }
            if (!isOpen) {
                logger.info('Unable to open ANT stick; re-trying...');
                retries --;
                await this.ant.close();
                await this.sleep(5000);
            }
        }
        while(!isOpen);
        
        // Retrieve the channel
        return this.ant.getChannel() as Channel;
    }

    // Instantiate the Ant sensors to be used in the app
    private async setupSensors(channel: Channel): Promise<void> {
        const allowedDevices = nconf.get('ant.allowed_devices');
        Object.entries(allowedDevices).forEach(async (entry) => {
            const key = entry[0];
            const value = parseInt(entry[1] as string);
            switch(key) {
                case 'pwr': 
                    logger.info('Initializing power meter sensor for device ', value);
                    channel.attach(new BicyclePowerSensor(value) as ISensor);
                    break;
                case 'fe':
                    logger.info('Initializing fitness equimenent sensor for device ', value);
                    channel.attach(new FitnessEquipmentSensor(value) as ISensor);
                    break;
                case 'cad':
                    logger.info('Initializing cadence sensor for device ', value);
                    channel.attach(new CadenceSensor(value) as ISensor);
                    break;
                case 'hr':
                    logger.info('Initializing heart rate sensor for device ', value);
                    channel.attach(new HeartRateSensor(value) as ISensor);
                    break;
            }
        });
    }

    // Handle the sensor messages
    private onDetected(profile: string, deviceId: number): void {
        switch(profile) {
            case 'PWR':
                this.profiles.set('pwr', Date.now());
                break;
            case 'FE':
                this.profiles.set('fe', Date.now());
                break;
            case 'CAD':
                this.profiles.set('cad', Date.now());
                break;
            case 'HR':
                this.profiles.set('hr', Date.now());
                this.heartRateMode?.onDetectedHandler(deviceId);
                break;
        }
        // Update profile last update timestamp
        this.profiles.set(profile.toLowerCase(), Date.now());
    }

    private onData(profile: string, deviceId: number, data: SensorState): void {
        if (this.isDataActive()) {
            switch(profile) {
                case 'PWR':            
                    break;
                case 'FE':
                    break;
                case 'CAD':
                    break;
                case 'HR':
                    this.heartRateMode?.onDataHandler(data);
                    break;
            }
        }
    }

    // Function to define whether a given data handler should be invoked or not
    // Currently, data handlers are only triggered if the PWR profile is detected
    // and active
    private isDataActive() {
        const pwrLastUpdate = this.profiles.get('pwr') || 0;
        const hrLastUpdate = this.profiles.get('hr') || 0;
        // Math.min because both devices must be present in order to enable data handler
        return ((Date.now() - Math.min(pwrLastUpdate, hrLastUpdate)) < this.profileTimeout);
    }

    // Main function
    private async startApp() {
        const channel = await this.getChannel();
        await this.setupSensors(channel);
    
        // Channel and sensors ready, crate the HeartRate smart mode
        this.heartRateMode = new HeartRateMode(logger, nconf);
    
        channel.on('detected', this.onDetected);
        channel.on('data', this.onData);
    
        await channel.startScanner();
    }

    // Clean app exit
    private async onAppExit(error?: Error) {
        const timerId = setTimeout( () => { throw new Error('Error: timeout trying to exit the app')}, 20000);
        try {
            let retCode = 0;
            if (error) {
                logger.info('Application exiting due to error:', error);
                retCode = -1;
            }
            else {
                logger.info('Exiting application');
            }
            await this.heartRateMode?.cleanup();
            await this.ant?.close();    
            process.exit(retCode);
        } catch (err) {
            clearTimeout(timerId);
            logger.error(err);
            process.exit(-1);
        }
    }

    // Initialize the app
    public static async initApp() {
        // Instantiate app
        const myApp = new App();

        // Configure process to exit app cleanly
        process.on('SIGINT',  async () => await myApp.onAppExit()); // CTRL+C
        process.on('SIGQUIT', async () => await myApp.onAppExit()); // Keyboard quit
        process.on('SIGTERM', async () => await myApp.onAppExit()); // `kill` command
        process.on('unhandledRejection', async (err: Error) => await myApp.onAppExit(err)); // Unhandled rejection at top-level

        // Start app
        await myApp.startApp();
    }
}

// Initialize the app
App.initApp();
