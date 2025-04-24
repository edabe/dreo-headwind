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

export type EnvironmentData = {
    temperatureC: number,
    temperatureF: number,
    humidityPercent: number
}

export type EventData = {
    cadence?: number;
    heartRate?: number;
    averagePower?: number;
}

/**
 * Declares the public interface that defines a data handler that controls the fan
 * or other device.
 * 
 * The handler will receive physiology data (HR, power, cadnece) as well as 
 * environment data (temperature, humidity).
 */
export abstract class DataHandler {
    /**
     * The data event handler.
     * This function will be called approximately every second.
     * 
     * @param performance The object containing physiology data.
     * @param environment The object containing environment data.
     */
    public abstract onPerformanceHandler(performance: PerformanceData, environment: EnvironmentData): void;

    /**
     * Cleanup function.
     * This should implement the asynchronous logic to clean up and reset the data handler.
     */
    public abstract cleanUp(): Promise<void>;
}