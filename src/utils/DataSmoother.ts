export default class DataSmoother {
    private buffer: number[] = [];
    private normBuffer: number[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    add(value: number): void {
        if (this.buffer.length >= this.maxSize) {
            this.buffer.shift(); // Remove the oldest value
            this.normBuffer.shift();
        }
        this.buffer.push(value);
        this.normBuffer.push(Math.pow(value, 4));
    }

    getAverage(): number {
        if (this.buffer.length === 0) return 0;
        return this.buffer.reduce((sum, val) => sum + val, 0) / this.buffer.length;
    }

    getAverageNorm(): number {
        if (this.normBuffer.length === 0) return 0;
        return Math.round(Math.pow(this.normBuffer.reduce((sum, val) => sum + val, 0) / this.normBuffer.length, 4));
    }
}
