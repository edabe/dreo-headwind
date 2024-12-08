import nconf from 'nconf';
import { Logger, ILogObj } from 'tslog';
import { DreoAPI } from '../src/control/DreoAPI';
import AntConnection from '../src/control/AntConnection';
import { Channel, ISensor } from 'incyclist-ant-plus';

class AntConnectionTest extends AntConnection {
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

// Mock DreoAPI
jest.mock('../src/control/DreoAPI');
const mockDreoAPI = jest.mocked(DreoAPI, { shallow: false });

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
    throw new Error(`Process exited with code: ${code}`);
});

jest.setTimeout(10000);

describe('AntConnectionTest', () => {
    afterEach(() => {
        mockExit.mockReset();
    });

    afterAll(() => {
        mockExit.mockRestore();
    });

    describe('Test startApp and exitApp', () => {
        const antConnection = new AntConnectionTest(logger, nconf);
        const dummyChannel = {
            attach: (sensor: ISensor) => {},
            on: (event: string, handler: (...args: any[]) => void) => {},
            startScanner: () => {}
        } as Channel;
        jest.spyOn(dummyChannel, 'attach');
        jest.spyOn(dummyChannel, 'on');
        jest.spyOn(dummyChannel, 'startScanner');
        const spyGetChannel = jest.spyOn((antConnection as unknown) as { getChannel: AntConnection['getChannel'] }, 'getChannel').mockImplementation((): Promise<Channel> => Promise.resolve(dummyChannel));

        it('Should call the right functions', async () => {
            await antConnection.startApp();
            expect(spyGetChannel).toHaveBeenCalled();
            expect(dummyChannel.attach).toHaveBeenCalledTimes(4);
            expect(dummyChannel.on).toHaveBeenCalledTimes(2);
            expect(dummyChannel.startScanner).toHaveBeenCalled();
        });
        it('Should exit gracefully', async () => {
            try {
                await antConnection.exitApp();
            } catch (error) {
                expect(error).toEqual(new Error('Process exited with code: 0'));
            }
        });
    });
});