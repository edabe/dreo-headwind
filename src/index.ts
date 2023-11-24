import { Logger, ILogObj } from 'tslog';
import nconf from 'nconf';
import { AntDevice, Channel, HeartRateSensor, BicyclePowerSensor, FitnessEquipmentSensor, CadenceSensor, ISensor, HeartRateSensorState  } from "incyclist-ant-plus";
import { SensorState } from 'incyclist-ant-plus/lib/sensors/base-sensor';
import HeartRateMode from './HeartRateMode';

// Initialize logger
const logger = new Logger<ILogObj>({ name: 'dreo-headwind-logger' });

// Load configuration file
nconf.file({ file: `${process.cwd()}/config/config.json` }).argv().env();

// Convenient sleeping function
const sleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// HeartRate smart mode
let heartRateMode: HeartRateMode;

// Ant initialization
// Windows might need a different initialization call - see 'fitness-equipment-advanced.js'
let ant: AntDevice;

// Retrieve the ant channel
async function getChannel(): Promise<Channel> {
    // Open the ant stick
    let retries = 10;
    let isOpen = false;
    do {
        ant = new AntDevice({ startupTimeout: 2000 });
        isOpen = await ant.open() as boolean;
        if (retries === 0) {
            const error = 'Failed to open ANT stick after multiple retries.' 
            logger.error(error);
            throw new Error(error);
        }
        if (!isOpen) {
            logger.info('Unable to open ANT stick; re-trying...');
            retries --;
            await ant.close();
            await sleep(5000);
        }
    }
    while(!isOpen);
    
    // Retrieve the channel
    return ant.getChannel() as Channel;
}

// Instantiate the Ant sensors to be used in the app
async function setupSensors(channel: Channel): Promise<void> {
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
function onDetected(profile: string, deviceId: number): void {
    logger.info('Detected', profile, deviceId);
}

function onData(profile: string, deviceId: number, data: SensorState): void {
    switch(profile) {
        case 'HR':
            heartRateMode?.onDataHandler(data);
            break;
    }
}

// Main function
async function main() {
    const channel = await getChannel();
    await setupSensors(channel);

    // Channel and sensors ready, crate the HeartRate smart mode
    heartRateMode = new HeartRateMode(logger, nconf);

    // channel.on('detected', onDetected);
    channel.on('data', onData);

    channel.startScanner();
}


// Clean app exit
async function onAppExit(error?: Error) {
    let retCode = 0;
    if (error) {
        logger.info('Application exiting due to error:', error);
        retCode = -1;
    }
    else {
        logger.info('Exiting application');
    }
    await heartRateMode.cleanup();
	await ant.close();
	process.exit(retCode);
}
process.on('SIGINT',  async () => await onAppExit()); // CTRL+C
process.on('SIGQUIT', async () => await onAppExit()); // Keyboard quit
process.on('SIGTERM', async () => await onAppExit()); // `kill` command
process.on('unhandledRejection', async (err: Error) => await onAppExit(err)); // Unhandled rejection at top-level

main();