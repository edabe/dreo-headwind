export type PowerData = {
    power: number,
    powerMax: number,
    powerZone: number,
    powerZoneTime: number
}

export type HeartRateData = {
    heartRate: number,
    heartRateMax: number,
    heartRateZone: number,
    heartRateZoneTime: number
}

export type CadenceData = {
    cadence: number,
    cadenceMax: number
}

export type PerformanceData = PowerData & HeartRateData & CadenceData & {
    normalizedPower: number,
    averagePower: number,
    averageHeartRate: number,
    averageCadence: number,
    intensityFactor: number,
    trainingStressScore: number
}

export type EventData = {
    cadence?: number;
    heartRate?: number;
    averagePower?: number;
}

/**
 * Declares the public interface that defines a performance data handler.
 * 
 * ANT device data handlers process PerformanceData types.
 */
export abstract class PerformanceHandler {
    /**
     * The performance event handler.
     * This callback will be called for every performance event emitted by the 
     * performance event emitter.
     * 
     * @param data The object containing the data to be processed.
     */
    public abstract onPerformanceHandler(data: PerformanceData): void;

    /**
     * Cleanup function.
     * This should implement the asynchronous logic to clean up and reset the data handler
     */
    public abstract cleanUp(): Promise<void>;
}