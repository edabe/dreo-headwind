import { Logger, ILogObj } from 'tslog';
import { AirCirculatorCalibration, AirCirculatorOscillation, DreoAPI } from './DreoAPI';
import { DreoProfiles } from './DreoProfile';
import ReconnectingWebSocket from 'reconnecting-websocket';

const logger = new Logger<ILogObj>({ name: 'dreo-headwind-logger' });
const dreo = new DreoAPI({ 'logger': logger, 'server': 'us', 'email': 'abe.shop@gmail.com', 'password': 'dreo-Linlin&Edu-1116' });

function sendCommand(device: string, parameters: object, websocket: ReconnectingWebSocket) {
    websocket.send(JSON.stringify({
        'devicesn': device,
        'method': 'control',
        'params': parameters,
        'timestamp': Date.now(),
    }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const devices = await dreo.getDevices();
    if (!devices.length) {
        logger.error('Failed to retrieve devices');
        process.exit(1);
    }
    const serialNumber = devices[0].serialNumber;
    await dreo.airCirculatorPowerOn(serialNumber, true);

    function setSpeed() {
        let speed = 1 + Math.floor(Math.random() * 5);
        let timeout = 1000 * (8 + Math.floor(Math.random() * 5));
        logger.info('Setting speed to ', speed, 'Waiting for', timeout);
        dreo.airCirculatorSpeed(serialNumber, speed);
        setTimeout(setSpeed, timeout);
    }
    setSpeed();
    logger.info('------- starting...');

    setInterval(() => {
        let oscillation = Math.floor(Math.random() * 4) as AirCirculatorOscillation;
        let profile = DreoProfiles[oscillation];
        logger.info('Applying profile', profile.toString());
        profile.apply(serialNumber, dreo);
    }, 30000);

    // devices.forEach(async device => {
    //     const state = await dreo.getState(device.serialNumber);
    //     logger.info('State', state);
    // });
    
    // // await dreo.test(devices[0].serialNumber);
    console.log(`--- temp: ${await dreo.getTemperature(devices[0].serialNumber)}`);
    // await dreo.airCirculatorPosition(devices[0].serialNumber, [-45, 15]);
    // await dreo.airCirculatorCruise(devices[0].serialNumber, AirCirculatorOscillation.VERTICAL, [0, 30], [15, 30]);
    // await dreo.airCirculatorCalibrate(devices[0].serialNumber, AirCirculatorCalibration.HORIZONTAL_VERTICAL);

    function onAppExit(): void {
        dreo.disconnect();
        console.log('disconnected');
        process.exit();
    }
    process.on('SIGINT', async () => onAppExit());  // CTRL+C
    process.on('SIGQUIT', async () => onAppExit()); // Keyboard quit
    process.on('SIGTERM', async () => onAppExit()); // `kill` command
})();