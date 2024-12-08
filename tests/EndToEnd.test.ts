/**
 * Excluded from `npm run test`.
 * Run with:
 *   npx jest EndToEnd
 */
import EventEmitter from 'events';
import nconf from 'nconf';
import { Logger, ILogObj } from 'tslog';
import { DreoAPI } from '../src/control/DreoAPI';
import AntConnection from '../src/control/AntConnection';
import sampleAll from './eventSeries.json';

function convertToMap(eventArray: DataObject[]): void {
    eventArray.forEach(item => {
        const timestamp = new Date(item.timestamp);
        const secondsSinceEpoch = Math.floor(timestamp.getTime() / 1000);
        switch(item.profile) {
            case 'HR':
                item.profileHr = 'HR';
                break;
            case 'PWR':
                item.profilePwr = 'PWR';
                break;
            case 'CAD': 
                item.profileCad = 'CAD';
                break;
        }
        const existingItem = eventMap.get(secondsSinceEpoch);
        if (existingItem) {
            Object.assign(item, existingItem);
        }
        eventMap.set(secondsSinceEpoch, item);
    });
}

function emitEvent(index: number, event: DataObject): void {
    if (event.profileHr) setTimeout(() => {
        emitter.emit('detected', 'HR', event.deviceId);
    }, 100);
    if (event.profileHr) setTimeout(() => {
        emitter.emit('data', 'HR', event.deviceId, event);
    }, 200);
    if (event.profilePwr) setTimeout(() => {
        emitter.emit('detected', 'PWR', event.deviceId);
    }, 300);
    if (event.profilePwr) setTimeout(() => {
        emitter.emit('data', 'PWR', event.deviceId, event);
    }, 400);
    if (event.profileCad) setTimeout(() => {
        emitter.emit('detected', 'CAD', event.deviceId);
    }, 500);
    setTimeout(() => {
        if (event.profileCad) emitter.emit('data', 'CAD', event.deviceId, event);
        emitter.emit('index', index);
    }, 600);
}

interface DataObject {
    timestamp: string;
    deviceId: number;
    profile?: string;
    profileHr?: string;
    profilePwr?: string;
    profileCad?: string;
    ComputedHeartRate?: number;
    BeatCount?: number;
    Power?: number;
    _0x10_EventCount?: number;
    CalculatedCadence?: number;
    CumulativeCadenceRevolutionCount?: number;
}

/**
 * Implements the ANT connection logic.
 */
class AntConnectionTest extends AntConnection {
    async parseAndEmitData(): Promise<void> {
        let index = 0;
        for (const event of eventMap.values()) {
            this.logger.info(`-              Generating event ${index+1} of ${eventMap.size}: ${event.ComputedHeartRate} / ${event.Power} / ${event.CalculatedCadence}`);
            emitEvent(index++, event);
            await this.sleep(400);
        }
    }

    /**
     * Initialize and start the application
     */
    public async startApp(): Promise<void> {
        this.onDetected = this.onDetected.bind(this);
        //this.onData = this.onData.bind(this);

        this.logger.info('Starting test app...');
        this.logger.info('Converting Cadence sample');
        // convertToMap(sampleCad);
        this.logger.info('Converting HR sample');
        // convertToMap(sampleHr);
        this.logger.info('Converting Power sample');
        // convertToMap(samplePwr);
        this.logger.info('Regisering event listeners');
        convertToMap(sampleAll);

        emitter.on('detected', (profile, deviceId) => {
            this.onDetected(profile, deviceId);
        });
        emitter.on('data', (profile, deviceId, data) => {
            this.onData(profile, deviceId, data);
        });
        emitter.on('index', index => {
            done = index >= eventMap.size -1
        });
        
        this.logger.info('Parsing and emitting events');
        await this.parseAndEmitData();

        this.logger.info('Waiting...');

        while (!done) {
            await this.sleep(500);
        }
        this.logger.info('Done: ', done);
    }

    public async exitApp(): Promise<void> {
        await this.onAppExit();
    }
}

// Initialize logger
const logger = new Logger<ILogObj>({ 
    name: 'dreo-headwind-logger',
    minLevel: 3
});

// Load configuration file
nconf.file({ file: `${process.cwd()}/config/config.json` }).argv().env();

const emitter = new EventEmitter();
const eventMap = new Map<number, DataObject>();
let done = false;

// Mock DreoAPI
jest.mock('../src/control/DreoAPI');
const mockDreoAPI = jest.mocked(DreoAPI, { shallow: false });

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
    throw new Error(`Process exited with code: ${code}`);
});

jest.setTimeout(60000);

describe('EndToEnd', () => {
    afterEach(() => {
        mockDreoAPI.mockClear();
        mockExit.mockReset();
    });

    afterAll(() => {
        mockExit.mockRestore();
    });

    it('Runs an end-to-end test', async () => {
        const app = new AntConnectionTest(logger, nconf);
        try {
            await app.startApp();
            await app.exitApp();
        } catch (error) {
            expect(error).toEqual(new Error('Process exited with code: 0'));
        }
    });
});



