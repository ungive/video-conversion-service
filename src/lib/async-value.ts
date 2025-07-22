import { Mutex } from 'async-mutex';

export class AsyncValue<T> {
  private value: T;
  private mutex = new Mutex();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  async set(newValue: T): Promise<void> {
    await this.mutex.runExclusive(() => {
      this.value = newValue;
    });
  }

  get(): T {
    return this.value;
  }

  async exchange(newValue: T): Promise<T> {
    return await this.mutex.runExclusive(() => {
      const oldValue = this.value;
      this.value = newValue;
      return oldValue;
    });
  }

  async read<R>(fn: (current: T) => Promise<R>): Promise<R> {
    return await this.mutex.runExclusive(async () => {
      return await fn(this.value);
    });
  }
}
