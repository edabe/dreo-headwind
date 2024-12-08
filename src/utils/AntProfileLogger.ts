import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream/promises';
import { BicyclePowerSensorState, CadenceSensorState, FitnessEquipmentSensorState, HeartRateSensorState } from 'incyclist-ant-plus';
import { SensorState } from 'incyclist-ant-plus/lib/sensors/base-sensor';
import { ILogObj, Logger } from 'tslog';

interface SensorLog {
    timestamp: string;
    deviceId: number;
    profile: string;
    eventCount: number;
}

class DeviceLogger {
    public logStream: fs.WriteStream | null = null;
    public buffer: SensorLog[] = [];
    public isNew: boolean = true;
}

function mapAntState(profile: string, data: SensorState): SensorLog {
    const sensorLog = {
        timestamp: new Date().toISOString(),
        deviceId: data.DeviceID,
        profile: profile,
        eventCount: 0
    };
    switch(profile) {
        case 'PWR': {
            const pwrData = data as BicyclePowerSensorState;
            Object.assign(sensorLog, {
                eventCount: pwrData._0x10_EventCount,
                avgPower: pwrData.Power,
                cadence: pwrData.Cadence
            });
            break;
        }
        case 'FE': {
            const feData = data as FitnessEquipmentSensorState;
            Object.assign(sensorLog, {
                eventCount: feData._0x19_EventCount,
                avgPower: feData._0x19_AveragePower,
                state: feData.State,
                distance: feData.Distance,
                speed: feData.RealSpeed
            });
            break;
        }
        case 'CAD': {
            const cadData = data as CadenceSensorState;
            Object.assign(sensorLog, {
                eventCount: cadData.CumulativeCadenceRevolutionCount,
                cadence: cadData.CalculatedCadence
            });
            break;
        }
        case 'HR': {
            const hrData = data as HeartRateSensorState;
            Object.assign(sensorLog, {
                eventCount: hrData.BeatCount,
                heartRate: hrData.ComputedHeartRate
            });
            break;
        }
    }
    return sensorLog;
}


/**
 * Log ANT events into separate log files
*/
export default class AntProfileLogger {
    private logger: Logger<ILogObj>;
    private deviceLoggers = new Map<string, DeviceLogger>();
    private isBusy = false;
    private bufferSize: number;
    private flushInterval: number;
    private flushIntervalId: NodeJS.Timeout | null = null;
    private isEnabled = false;

    constructor(logger: Logger<ILogObj>, bufferSize = 50, flushInterval = 1000) {
        this.logger = logger;
        this.bufferSize = bufferSize;
        this.flushInterval = flushInterval;
        this.isEnabled = false;
    }

    // Start logging session for heart rate and power
    public startSession(): void {
        if (!this.isEnabled) return;
        if (this.deviceLoggers.size == 0) {
            this.logger.info('Starting ANT+ event logger session');
            this.isBusy = true;
            this.deviceLoggers.set('PWR', new DeviceLogger());
            this.deviceLoggers.set('HR', new DeviceLogger());
            this.deviceLoggers.set('CAD', new DeviceLogger());
            this.deviceLoggers.set('FE', new DeviceLogger());
            this.createLogStream();
            this.startFlushInterval();
            this.isBusy = false;
        }
    }

    // Log a specific sensor value
    public logSensorEvent(profile: string, deviceId: number, data: SensorState): void {
        if (!this.isEnabled) return;
        this.logger.debug(`Logging ANT+ event ${profile} : ${deviceId}`);
        const deviceLogger = this.deviceLoggers.get(profile);
        if (!this.isBusy && deviceLogger) {
            const sensorLogEntry = mapAntState(profile, data);
            deviceLogger.buffer.push(sensorLogEntry);
            if (deviceLogger.buffer.length >= this.bufferSize) {
                // not awaiting in this function
                this.flushBuffer(deviceLogger);
            }
        }
    }

    // End the logging session
    public async endSession(): Promise<void> {
        if (!this.isEnabled) return;
        this.logger.info('Ending ANT+ event logger session');
        for (const deviceLogger of this.deviceLoggers.values()) {
            await this.flushBuffer(deviceLogger);
            await this.closeLogStream(deviceLogger);
        }
        this.deviceLoggers.clear();
        this.stopFlushInterval();
    }

    // Helper methods
    private createLogStream(): void {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logsDir = path.join(process.cwd(), 'logs');

        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir);
        }

        for (const [profile, deviceLogger] of this.deviceLoggers ) {
            const filePath = path.join(logsDir, `${profile}_${timestamp}.json`);
            this.logger.info(`Creating logger stream ${filePath}`);
            deviceLogger.logStream = fs.createWriteStream(filePath, { flags: 'w' });
            deviceLogger.isNew = true;
        }
    }

    private async flushBuffer(deviceLogger: DeviceLogger): Promise<void> {
        const logStream = deviceLogger.logStream;
        const buffer = deviceLogger.buffer;

        if (logStream && buffer.length > 0) {
            this.logger.debug(`Flushing ANT+ event stream ${logStream.path}`);
            const data = (deviceLogger.isNew ? '[\n' : ',\n') + buffer.map(entry => JSON.stringify(entry)).join(',\n') ;//+ ',,\n';
            if (!logStream.write(data)) {
                stream.finished(logStream);
            }
            buffer.length = 0; // Clear the buffer
            deviceLogger.isNew = false;
        }
    }

    private async closeLogStream(deviceLogger: DeviceLogger): Promise<void> {
        if (deviceLogger.logStream) {
            this.logger.debug(`Closing ANT+ event stream ${deviceLogger.logStream.path}`);
            await stream.finished(deviceLogger.logStream.end('\n]\n'));
            deviceLogger.logStream = null;
        }
    }

    private startFlushInterval(): void {
        this.flushIntervalId = setInterval(async () => {
            for (const deviceLogger of this.deviceLoggers.values()) {
                await this.flushBuffer(deviceLogger);
            }
        }, this.flushInterval);
    }

    private stopFlushInterval(): void {
        if (this.flushIntervalId) {
            clearInterval(this.flushIntervalId);
            this.flushIntervalId = null;
        }
    }
}
