/**
 * Testing this file separately:
 * npx jest .test.ts
 */
import nconf from 'nconf';
import * as path from 'path';
import { SwitchBotHub2 } from 'switchbot-hub2-ble';
import { DreoAPI } from '../../src/fan/DreoAPI';
import AntConnector from '../../src/ant/AntConnector'
import { ILogObj, Logger } from 'tslog';
import { Provider } from 'nconf';
import { AntDevice, Channel, BicyclePowerSensor, HeartRateSensor, BicyclePowerSensorState, HeartRateSensorState, CadenceSensorState } from 'incyclist-ant-plus';

jest.mock('incyclist-ant-plus', () => {
    const actual = jest.requireActual('incyclist-ant-plus');
    return {
        ...actual,
        AntDevice: jest.fn().mockImplementation(() => ({
            open: jest.fn().mockResolvedValue(true),
            close: jest.fn().mockResolvedValue(undefined),
            getChannel: jest.fn().mockReturnValue({
                attach: jest.fn(),
                on: jest.fn(),
                startScanner: jest.fn().mockResolvedValue(undefined),
            }),
        })),
        BicyclePowerSensor: jest.fn(),
        HeartRateSensor: jest.fn(),
    };
});

jest.mock('switchbot-hub2-ble', () => ({
    SwitchBotHub2: {
        on: jest.fn(),
        startScanning: jest.fn(),
        stopScanning: jest.fn(),
        isScanning: jest.fn()
    }
}));

jest.mock('../../src/fan/DreoAPI', () => {
    return {
        DreoAPI: jest.fn().mockImplementation(() => ({
            airCirculatorPowerOn: jest.fn(),
            disconnect: jest.fn()
        }))
    };
});

describe('AntConnector App Init', () => {
    let mockLogger: Logger<ILogObj>;
    let antConn: AntConnector;

    beforeEach(() => {
        // Load configuration file
        const configPath = path.resolve(__dirname, '../../tests/config/config.test.json');
        nconf.file({ file: configPath }).argv().env();
        
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as Logger<ILogObj>;
        antConn = new AntConnector(mockLogger, nconf);
    });

    afterEach(() => {
        jest.clearAllMocks();
        nconf.reset();
        // Remove all handlers that were added in AntConnector constructor
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGQUIT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('unhandledRejection');
        (SwitchBotHub2.on as jest.Mock).mockReset();
        (SwitchBotHub2.startScanning as jest.Mock).mockReset();
        (SwitchBotHub2.stopScanning as jest.Mock).mockReset();
        (SwitchBotHub2.isScanning as jest.Mock).mockReset();
    });
    
    it('should initialize with logger and allowed devices', () => {
        expect(antConn).toBeDefined();
        expect(antConn['allowedDevices']).toEqual({
            pwr: "46683",
            fe: "46683",
            cad: "53826",
            hr: "22450"
        });
    });

    it('should start app and setup sensors correctly', async () => {
        await antConn.startApp();

        const AntDeviceMock = AntDevice as unknown as jest.Mock;
        const antDeviceInstance = AntDeviceMock.mock.results[0].value;

        expect(antDeviceInstance.open).toHaveBeenCalled();
        expect(antDeviceInstance.getChannel).toHaveBeenCalled();

        const channel = antDeviceInstance.getChannel();
        expect(channel.attach).toHaveBeenCalledTimes(4); // pwr + fe + cad + hr 
        expect(channel.on).toHaveBeenCalledWith('detected', expect.any(Function));
        expect(channel.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(channel.startScanner).toHaveBeenCalled();
    });

    it('should track active profile timeout on detection', () => {
        jest.useFakeTimers();
        const pwrProfile = 'PWR';
        const pwrDeviceId = 12345;
        const hrProfile = 'HR';
        const hrDeviceId = 67890;

        antConn['activeProfiles']
    
        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    
        // Act
        antConn['onDetected'](pwrProfile, pwrDeviceId);
        jest.advanceTimersByTime(10000);
    
        // Assert cleartimeout was called and timeout is set
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(antConn['activeProfiles'].get(pwrProfile)).toBeDefined();
    
        // Check logger was called
        expect(mockLogger.debug).toHaveBeenCalledWith(`Device detected: ${pwrDeviceId} (${pwrProfile})`);

        clearTimeoutSpy.mockClear();
        setTimeoutSpy.mockClear();

        // Act
        antConn['onDetected'](hrProfile, hrDeviceId);
        jest.advanceTimersByTime(10000);

        // Assert cleartimeout was called and timeout is set
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(antConn['activeProfiles'].get(hrProfile)).toBeDefined();

        // Check logger was called
        expect(mockLogger.debug).toHaveBeenCalledWith(`Device detected: ${hrDeviceId} (${hrProfile})`);

        clearTimeoutSpy.mockClear();
        setTimeoutSpy.mockClear();

        // Act
        jest.advanceTimersByTime(41000);

        // Check logger was called for PWR
        expect(mockLogger.info).toHaveBeenCalledWith(`No device activity: ${pwrDeviceId} (${pwrProfile})`);
        expect(mockLogger.info).not.toHaveBeenCalledWith(`No device activity: ${hrDeviceId} (${hrProfile})`);

        // Assert timeout is triggered
        expect(antConn['activeProfiles'].get(pwrProfile)).toBeUndefined();
        expect(antConn['activeProfiles'].get(hrProfile)).toBeDefined();
    
        // Assert app is on standby
        expect(mockLogger.info).toHaveBeenCalledWith('Performance handler switching to standby');

        // Act
        jest.advanceTimersByTime(10000);

        // Check logger was called for HR
        expect(mockLogger.info).toHaveBeenCalledWith(`No device activity: ${hrDeviceId} (${hrProfile})`);
        
        clearTimeoutSpy.mockRestore();
        setTimeoutSpy.mockRestore();
        jest.useRealTimers();
    });

    it('should cache data when event is new', () => {
        const pwrData = {
            profile: 'PWR',
            deviceId: 12345,
            data: {
                Power: 150,
                _0x10_EventCount: 1
            } as BicyclePowerSensorState
        }
        const hrData = {
            profile: 'HR',
            deviceId: 23456,
            data: {
                ComputedHeartRate: 165,
                BeatCount: 1
            } as HeartRateSensorState
        }
        const cadData = {
            profile: 'CAD',
            deviceId: 34567,
            data: {
                CalculatedCadence: 95,
                CumulativeCadenceRevolutionCount: 1
            } as CadenceSensorState
        }
    
        antConn['cachedPerfDataType'].powerCount = 0;
        antConn['cachedPerfDataType'].beatCount = 0;
        antConn['cachedPerfDataType'].cadenceCount = 0;
    
        // Handle power data
        antConn['onData'](pwrData.profile, pwrData.deviceId, pwrData.data);
    
        expect(antConn['cachedPerfDataType'].powerCount).toBe(1);
        expect(antConn['cachedPerfDataType'].averagePower).toBe(150);

        // Handle heartrate data
        antConn['onData'](hrData.profile, hrData.deviceId, hrData.data);
    
        expect(antConn['cachedPerfDataType'].beatCount).toBe(1);
        expect(antConn['cachedPerfDataType'].heartRate).toBe(165);

        // Handle cadence data
        antConn['onData'](cadData.profile, cadData.deviceId, cadData.data);
    
        expect(antConn['cachedPerfDataType'].cadenceCount).toBe(1);
        expect(antConn['cachedPerfDataType'].cadence).toBe(95);
    });

    it('should discard data when event is duplicated', () => {
        const pwrData = {
            profile: 'PWR',
            deviceId: 12345,
            data: {
                Power: 150,
                _0x10_EventCount: 1
            } as BicyclePowerSensorState
        }
        const hrData = {
            profile: 'HR',
            deviceId: 23456,
            data: {
                ComputedHeartRate: 165,
                BeatCount: 1
            } as HeartRateSensorState
        }
        const cadData = {
            profile: 'CAD',
            deviceId: 34567,
            data: {
                CalculatedCadence: 95,
                CumulativeCadenceRevolutionCount: 1
            } as CadenceSensorState
        }
    
        const cache = antConn['cachedPerfDataType'];
        cache.powerCount = 1;
        cache.averagePower = 0;
        cache.beatCount = 1;
        cache.heartRate = 0;
        cache.cadenceCount = 1;
        cache.cadence = 0;
    
        // Handle power data
        antConn['onData'](pwrData.profile, pwrData.deviceId, pwrData.data);
    
        expect(antConn['cachedPerfDataType'].powerCount).toBe(1);
        expect(antConn['cachedPerfDataType'].averagePower).toBe(0);
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring Power data handler'));

        // Handle heartrate data
        antConn['onData'](hrData.profile, hrData.deviceId, hrData.data);
    
        expect(antConn['cachedPerfDataType'].beatCount).toBe(1);
        expect(antConn['cachedPerfDataType'].heartRate).toBe(0);
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring HR data handler'));

        // Handle cadence data
        antConn['onData'](cadData.profile, cadData.deviceId, cadData.data);
    
        expect(antConn['cachedPerfDataType'].cadenceCount).toBe(1);
        expect(antConn['cachedPerfDataType'].cadence).toBe(0);
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring Cadence data handler'));
    });

    it('should start BLE sampling when data is active', async () => {
        const sbconfig = nconf.get('switchbot.config');
        const options = {
            mac: sbconfig?.bleMac,
            interval: sbconfig?.interval,
            duration: sbconfig?.duration
        }

        jest.useFakeTimers();
        // Simulate ANT+ profile detection to trigger environment scanner
        antConn['activeProfiles'].set('PWR', setTimeout(() => {}, 60000));
        antConn['activeProfiles'].set('HR', setTimeout(() => {}, 60000));

        // Call onDetected to trigger BLE scanner
        antConn['onDetected']('PWR', 12345);

        expect(SwitchBotHub2.startScanning).toHaveBeenCalledWith(options);
        jest.advanceTimersByTime(70000);
    });
      
    it('should stop BLE sampling on standby', async () => {      
        jest.useFakeTimers();

        // Simulate ANT+ profile detection to trigger environment scanner
        antConn['activeProfiles'].set('PWR', setTimeout(() => {}, 60000));
        antConn['activeProfiles'].set('HR', setTimeout(() => {}, 60000));
            
        antConn['onDetected']('PWR', 12345);
        expect(SwitchBotHub2.startScanning).toHaveBeenCalled();
      
        // Mark one profile as inactive
        antConn['activeProfiles'].set('PWR', undefined);
      
        await antConn['dataHandlerStandBy']();
      
        expect(SwitchBotHub2.stopScanning).toHaveBeenCalled(); // Verifies stopScanning() was invoked
        jest.advanceTimersByTime(70000);
    });

    it('should cache BLE data on "data" event', () => {
        const sampleData = {
            temperatureC: 21.3,
            temperatureF: 70.3,
            humidityPercent: 42.1
        };
    
        // Manually invoke the 'data' listener from SwitchBotHub2
        const onSpy = jest.spyOn(SwitchBotHub2, 'on');
        const handler = onSpy.mock.calls.find(call => call[0] === 'data')?.[1];
        
        expect(handler).toBeDefined();
        handler?.(sampleData);
    
        expect(antConn['cachedEnvDataType'].temperatureC).toBe(sampleData.temperatureC);
        expect(antConn['cachedEnvDataType'].temperatureF).toBe(sampleData.temperatureF);
        expect(antConn['cachedEnvDataType'].humidityPercent).toBe(sampleData.humidityPercent);
    });
    
    it('should NOT start BLE scan if only one sensor is active', () => {
        jest.useFakeTimers();

        antConn['activeProfiles'].set('PWR', setTimeout(() => {}, 60000));
        antConn['activeProfiles'].set('HR', undefined); // Only one active
    
        antConn['onDetected']('PWR', 12345);
    
        expect(SwitchBotHub2.startScanning).not.toHaveBeenCalled();
        jest.advanceTimersByTime(70000);
    });

    it('should not crash when BLE data is incomplete', () => {
        const handler = jest.spyOn(SwitchBotHub2, 'on').mock.calls.find(c => c[0] === 'data')?.[1];
        expect(() => handler?.({})).not.toThrow(); // shouldn't crash
    });
    

    it('should not call startScanning again if already running', () => {
        jest.useFakeTimers();

        const isScanningMock = SwitchBotHub2.isScanning as jest.Mock;
        
        antConn['activeProfiles'].set('PWR', setTimeout(() => {}, 60000));
        antConn['activeProfiles'].set('HR', setTimeout(() => {}, 60000));
    
        // First trigger
        antConn['onDetected']('PWR', 12345);
        expect(SwitchBotHub2.startScanning).toHaveBeenCalledTimes(1);

        // Simulate that scanning is already in progress
        isScanningMock.mockReturnValue(true);

        // Second trigger — should not call again
        antConn['onDetected']('HR', 23456);
        expect(SwitchBotHub2.startScanning).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(70000);
    });
    
});

describe('AntConnector App Exit', () => {
    let antConn: AntConnector;
    let mockExit: jest.Mock;
    let mockLogger: Logger<ILogObj>;

    beforeEach(() => {
        // Load configuration file
        const configPath = path.resolve(__dirname, '../../tests/config/config.test.json');
        nconf.file({ file: configPath }).argv().env();

        mockLogger = { info: jest.fn(), debug: jest.fn(), error: jest.fn() } as unknown as Logger<ILogObj>;

        mockExit = jest.fn((code: number): never => {
            throw new Error(`process.exit called with ${code}`);
        });

        // Mock AntDevice class and reset mocks
        const AntDeviceMock = AntDevice as jest.MockedClass<typeof AntDevice>;
        AntDeviceMock.mockClear();
        
        antConn = new AntConnector(mockLogger, nconf);
        const antDeviceInstance = new AntDeviceMock();  // This should give the mocked instance
        antConn['ant'] = antDeviceInstance;
        antConn['processExit'] = mockExit as unknown as (code?: number) => never;
        antConn['sleep'] = async () => {};
        antConn['activeProfiles'].set('PWR', setTimeout(() => {}, 1000));

        // Rely on fake timers
        jest.useFakeTimers();
    });

    afterEach(() => {
        mockExit.mockRestore();
        nconf.reset();
        // Remove all handlers that were added in AntConnector constructor
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGQUIT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('unhandledRejection');
        (SwitchBotHub2.on as jest.Mock).mockReset();
        (SwitchBotHub2.startScanning as jest.Mock).mockReset();
        (SwitchBotHub2.stopScanning as jest.Mock).mockReset();
        (SwitchBotHub2.isScanning as jest.Mock).mockReset();
        jest.useRealTimers();
    });

    it('should clean up and exit gracefully on success', async () => {
        // Ensure that timeouts are cleared
        const timeoutSpy = jest.spyOn(global, 'clearTimeout');

        await expect(antConn['onAppExit']()).rejects.toThrow('process.exit called with 0');
        
        // Verify cleanup and logging
        expect(mockLogger.info).toHaveBeenCalledWith('Exiting application');
        expect(mockLogger.info).toHaveBeenCalledWith('Cleaning up active profile: ', 'PWR');
        expect(mockLogger.info).toHaveBeenCalledWith('Cleaning up dataHandlers');
        
        // Verify closing of ANT device
        const antDeviceInstance = antConn['ant'];
        expect(antDeviceInstance.close).toHaveBeenCalled();

        // Ensure process.exit() was called with code 0
        expect(mockExit).toHaveBeenCalledWith(0);
        
        expect(timeoutSpy).toHaveBeenCalledTimes(2);
        timeoutSpy.mockRestore();
    });

    it('should clean up and exit gracefully on error', async () => {
        // Ensure that timeouts are cleared
        const timeoutSpy = jest.spyOn(global, 'clearTimeout');

        const error = new Error('dummy');
        await expect(antConn['onAppExit'](error)).rejects.toThrow('process.exit called with -1');
        
        // Verify cleanup and logging
        expect(mockLogger.info).toHaveBeenCalledWith('Application exiting due to error:', error);
        expect(mockLogger.info).toHaveBeenCalledWith('Cleaning up active profile: ', 'PWR');
        expect(mockLogger.info).toHaveBeenCalledWith('Cleaning up dataHandlers');
        
        // Verify closing of ANT device
        const antDeviceInstance = antConn['ant'];
        expect(antDeviceInstance.close).toHaveBeenCalled();

        // Ensure process.exit() was called with code 0
        expect(mockExit).toHaveBeenCalledWith(-1);
        
        expect(timeoutSpy).toHaveBeenCalledTimes(2);
        timeoutSpy.mockRestore();
    });

    it('should NOT call stopScanning if BLE config is undefined', async () => {
        antConn['switchbotOptions'] = undefined;
    
        expect(SwitchBotHub2.stopScanning).not.toHaveBeenCalled();
        await expect(antConn['onAppExit']()).rejects.toThrow();
        expect(SwitchBotHub2.stopScanning).not.toHaveBeenCalled();
    });
});

