export default class DataSmoother {
    private buffer: number[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    add(value: number): void {
        if (this.buffer.length >= this.maxSize) {
            this.buffer.shift(); // Remove the oldest value
        }
        this.buffer.push(value);
    }

    getAverage(): number {
        if (this.buffer.length === 0) return 0;
        return this.buffer.reduce((sum, val) => sum + val, 0) / this.buffer.length;
    }
}
