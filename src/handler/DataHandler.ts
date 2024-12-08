export interface DataType{
    cadence?: number;
    heartRate?: number;
    averagePower?: number;
}

/**
 * Declares the public interface that defines an ANT device data handler.
 * 
 * ANT device data handlers process DataType types.
 */
export abstract class DataHandler {
    /**
     * The data event handler.
     * This callback will be called for every data event emitted by the corresponding
     * 
     * @param data The object containing the data to be processed.
     */
    public abstract onDataHandler(data: DataType): void;

    /**
     * Cleanup function.
     * This should implement the asynchronous logic to clean up and reset the data handler
     */
    public abstract cleanUp(): Promise<void>;
}