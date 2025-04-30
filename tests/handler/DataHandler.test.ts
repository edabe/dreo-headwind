import { AntDevice, Channel, BicyclePowerSensorState, HeartRateSensorState, CadenceSensorState } from 'incyclist-ant-plus';
import { SwitchBotHub2 } from 'switchbot-hub2-ble';
import AntConnector from '../../src/ant/AntConnector';
import { PerformanceHandler, EnvironmentData, PerformanceData } from '../../src/handler/DataHandler';
import { Logger, ILogObj } from 'tslog';
import nconf from 'nconf';
import path from 'path';

jest.mock('switchbot-hub2-ble', () => ({
  SwitchBotHub2: {
    on: jest.fn(),
    startScanning: jest.fn(),
    stopScanning: jest.fn(),
    isScanning: jest.fn().mockReturnValue(false)
  }
}));

describe('AntConnector AntHandler Integration', () => {
  let antConn: AntConnector;
  let mockLogger: Logger<ILogObj>;
  let mockHandler: PerformanceHandler;
  const mockPerformanceData: PerformanceData = {
    power: 150,
    powerMax: 250,
    powerZone: 3,
    powerZoneTime: 10,
    heartRate: 165,
    heartRateMax: 180,
    heartRateZone: 4,
    heartRateZoneTime: 20,
    cadence: 90,
    cadenceMax: 100,
    normalizedPower: 160,
    averagePower: 140,
    averageHeartRate: 158,
    averageCadence: 88,
    intensityFactor: 0.9,
    trainingStressScore: 75.3
  };
  const mockEnvironmentData: EnvironmentData = {
    temperatureC: 22,
    temperatureF: 72,
    humidityPercent: 45
  };

  beforeEach(() => {
    jest.useFakeTimers();
    const configPath = path.resolve(__dirname, '../../tests/config/config.test.json');
    nconf.file({ file: configPath }).argv().env();

    mockLogger = { info: jest.fn(), debug: jest.fn(), error: jest.fn() } as unknown as Logger<ILogObj>;

    mockHandler = {
      onPerformanceData: jest.fn(),
      cleanUp: jest.fn().mockResolvedValue(undefined)
    };

    antConn = new AntConnector(mockLogger, nconf);
    antConn['performanceHandlers'] = [mockHandler];

    antConn['activeProfiles'].set('PWR', setTimeout(() => {}, 60000));
    antConn['activeProfiles'].set('HR', setTimeout(() => {}, 60000));
    antConn['cachedPerfDataType'] = {
      averagePower: 150,
      heartRate: 165,
      cadence: 90,
      powerCount: 1,
      beatCount: 1,
      cadenceCount: 1
    };
    antConn['cachedEnvDataType'] = mockEnvironmentData;
    antConn['performanceMetrics'].getPerformanceData = jest.fn(() => mockPerformanceData);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.advanceTimersByTime(70000);
    jest.useRealTimers();
  });

  it('should call onPerformanceHandler with calculated metrics', () => {
    const data: HeartRateSensorState = { ComputedHeartRate: 165, BeatCount: 2 } as HeartRateSensorState;
    antConn['onData']('HR', 12345, data);

    expect(mockHandler.onPerformanceData).toHaveBeenCalledWith(mockPerformanceData, mockEnvironmentData);
  });

  it('should call cleanUp() on dataHandlerStandBy()', async () => {
    antConn['activeProfiles'].set('PWR', undefined);
    await antConn['dataHandlerStandBy']();

    expect(mockHandler.cleanUp).toHaveBeenCalled();
    expect(SwitchBotHub2.stopScanning).toHaveBeenCalled();
  });

  it('should not call onPerformanceHandler if sensors are inactive', () => {
    antConn['activeProfiles'].set('PWR', undefined);
    const data: HeartRateSensorState = { ComputedHeartRate: 170, BeatCount: 3 } as HeartRateSensorState;
    antConn['onData']('HR', 12345, data);

    expect(mockHandler.onPerformanceData).not.toHaveBeenCalled();
  });
});
