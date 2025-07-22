import { Mutex } from "async-mutex"

export class AsyncCounter {
  private value: number;
  private mutex: Mutex;

  constructor(initialValue = 0) {
    this.value = initialValue;
    this.mutex = new Mutex();
  }

  async read(): Promise<number> {
    return this.mutex.runExclusive(() => this.value);
  }

  async increment(): Promise<number> {
    return this.mutex.runExclusive(() => {
      this.value += 1;
      return this.value;
    });
  }

  async decrement(): Promise<number> {
    return this.mutex.runExclusive(() => {
      this.value -= 1;
      return this.value;
    });
  }
}
