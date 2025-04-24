import nconf from 'nconf';
import path from 'path';
import { ILogObj, Logger } from 'tslog';
import AntConnector from './ant/AntConnector';

const logger = new Logger<ILogObj>({ name: 'ANT App' });

try {
    // Define full path to config/config.json
    const configPath = path.join(__dirname, '..', 'config', 'config.json');

    // Load config
    nconf
        .argv()
        .env()
        .file({ file: configPath });

    // Validate essential config keys
    const allowedDevices = nconf.get('ant.allowed_devices');
    if (!allowedDevices || typeof allowedDevices !== 'object') {
        throw new Error(`Missing or invalid 'ant.allowed_devices' in config: ${configPath}`);
    }

    logger.info(`Configuration loaded successfully from ${configPath}`);

    // Start ANT connection
    const antConn = new AntConnector(logger, nconf);
    antConn.startApp();
} catch (err) {
    logger.fatal('Failed to start application:', err);
    process.exit(1);
}