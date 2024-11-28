import nconf from 'nconf';
import { Logger, ILogObj } from 'tslog';

import HeartRateMode from '../src/model/HeartRateMode';
import { DreoAPI } from '../src/control/DreoAPI';

// Initialize logger
const logger = new Logger<ILogObj>({ 
    name: 'dreo-headwind-logger',
    minLevel: 3
});

// Load configuration file
nconf.file({ file: `${process.cwd()}/config/config.json` }).argv().env();
nconf.set('user.heartrate', {
    "zones": [ [40,60], [60,70], [70,80], [80,90], [90,100] ],
    "max": 180,
    "rest": 55
});

// Mock DreoAPI
jest.mock('../src/control/DreoAPI');
const mockDreoAPI = jest.mocked(DreoAPI, { shallow: false });

// Heart rate mode instance
let hrm: HeartRateMode;
beforeAll(() => {
    hrm = new HeartRateMode(logger, nconf);
});

beforeEach(() => {
    // mockDreoAPI.mockClear();
});

describe('HeartRateMode', () => {
    describe('Constructor and clean up', () => {
        it('Checks if DreoAPI constructor is called once', () => {
            expect(DreoAPI).toHaveBeenCalledTimes(1);
        });
        
        it('Checks that the cleanup routine works', async () => {
            const serialNumber = nconf.get('dreo.config').serialNumber;
            await hrm.cleanup();
            expect(DreoAPI.prototype.airCirculatorPowerOn).toHaveBeenCalledWith(serialNumber, false);
            expect(DreoAPI.prototype.disconnect).toHaveBeenCalledTimes(1);
        });

    });

    describe('Callbacks', () => {
        it('Checks that onDataHandler works as expected', () => {
            // TBD
        });

        it('Checks that onDetectHandler works as expected', () => {
            // TBD
        });
    });
});
