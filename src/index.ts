import { Logger, ILogObj } from 'tslog';
import nconf from 'nconf';
import AntConnection from './control/AntConnection';

// Load configuration file
nconf.file({ file: `${process.cwd()}/config/config.json` }).argv().env();

// Initialize logger
const logger = new Logger<ILogObj>({ 
    name: 'dreo-headwind-logger',
    minLevel: 3
});

// Instantiate the app
const app = new AntConnection(logger, nconf);

// Initialize and start
app.startApp();
