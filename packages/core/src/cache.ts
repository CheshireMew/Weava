/** A cache is an optimization only: eviction must never change the result. */
export class BoundedCache<K, V> {
  private items = new Map<K, { value: V; weight: number }>();
  private weight = 0;
  constructor(private maximum = 128, private maximumWeight = 16 * 1024 * 1024) {}
  get(key: K): V | undefined {
    const item = this.items.get(key);
    if (!item) return;
    this.items.delete(key); this.items.set(key, item);
    return item.value;
  }
  set(key: K, value: V, weight = 1) {
    this.delete(key);
    if (weight > this.maximumWeight) return value;
    this.items.set(key, { value, weight }); this.weight += weight;
    while (this.items.size > this.maximum || this.weight > this.maximumWeight) this.delete(this.items.keys().next().value!);
    return value;
  }
  delete(key: K) { const item = this.items.get(key); if (item) { this.weight -= item.weight; this.items.delete(key); } }
  clear() { this.items.clear(); this.weight = 0; }
}
