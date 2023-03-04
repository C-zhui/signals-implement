type Unsubscribe = (() => void) | void;

const utils = {
  noop: () => {},
  createId: () => Math.random().toString().slice(2),
};

const log2 = console.log;
const log = utils.noop || console.log;

class Schedule {
  queueIndex = {} as Record<string, EffectNode>;
  queue: EffectNode[] = [];

  run() {
    if (!this.queue.length) return;

    this.queue.sort((a, b) => -(a.priority - b.priority));
    const node = this.queue.pop();
    log('Schedule run', this, node);
    delete this.queueIndex[node.id];
    node.run();
    return this.run();
  }

  add(node: EffectNode) {
    if (this.queueIndex[node.id]) return;
    log('Schedule add', node);
    this.queueIndex[node.id] = node;
    this.queue.push(node);
  }
}

const schedule = new Schedule();

abstract class EffectNode {
  static effectStack: EffectNode[] = [];
  id = utils.createId();
  priority: number = 1;
  dirty = false;
  prev = {} as Record<string, EffectNode>;
  next = {} as Record<string, EffectNode>;
  type = 'EffectNode';

  /** 依赖栈 */
  addCurrentEffect() {
    log('addCurrentEffect', this);
    EffectNode.effectStack.push(this);
  }

  /** 依赖栈 */
  popCurrentEffect() {
    log('popCurrentEffect', this);
    if (EffectNode.effectStack[EffectNode.effectStack.length - 1] === this) {
      EffectNode.effectStack.pop();
    }
  }

  /** 添加到栈顶依赖中 */
  collect() {
    log('collect', this);
    const cur = EffectNode.effectStack[EffectNode.effectStack.length - 1];
    if (cur) {
      if (this.next[cur.id]) {
        return;
      }

      this.next[cur.id] = cur;
      cur.prev[this.id] = this;
      cur.priority += this.priority;
    }
  }

  /** 上游释放 */
  release() {
    log('release', this);
    Object.values(this.prev).forEach((prevNode) => {
      delete prevNode.next[this.id];
    });
    this.priority = 1;
    this.prev = {};
  }

  /** 更新优先级 */
  updatePriority() {
    this.priority = Object.values(this.prev)
      .map((n) => n.priority)
      .reduce((a, b) => a + b, 0);
  }

  /** 通知下游 */
  notifyAll() {
    log('notifyAll', this);
    // mark dirty and add to schedule
    Object.values(this.next).forEach((n) => {
      n.dirty = true;
      schedule.add(n);
    });
    schedule.run();
  }

  run() {
    this.dirty = false;
  }
}

/** 原子状态 */
class Signal<T> extends EffectNode {
  type = 'Signal';

  _value: T;
  constructor(init: T) {
    super();
    this._value = init;
  }

  get value() {
    log('Signal value', this);
    this.collect();
    return this._value;
  }

  run() {
    log('Signal run', this);
    super.run();
  }

  peek() {
    log('Signal peek', this);
    return this._value;
  }

  set value(v: T) {
    log('Signal set', this);
    this._value = v;
    this.notifyAll();
  }
}

/** 惰性求值 */
class Computed<T> extends EffectNode {
  type = 'Computed';
  _value: T;
  computeFn: () => T;
  constructor(computeFn: () => T) {
    super();
    this.computeFn = computeFn;
    this.dirty = true;
  }

  _ensureComputed() {
    log('Computed _ensureComputed', this);
    if (this.dirty) {
      this.release();
      this.addCurrentEffect();
      this._value = this.computeFn();
      this.popCurrentEffect();
      this.updatePriority();
    }
  }

  get value() {
    log('Computed value', this);
    this.collect();
    this._ensureComputed();
    return this._value;
  }

  peek() {
    return this._value;
  }

  run(): void {
    log('Computed run');
    this._ensureComputed();
    super.run();
    this.notifyAll();
  }
}

class Effect extends EffectNode {
  type = 'Effect';
  effectFn: () => Unsubscribe;
  destroy: Unsubscribe = null;
  running: boolean = false;
  manual: boolean;

  constructor(effectFn: () => Unsubscribe, manual?: boolean) {
    super();
    this.effectFn = effectFn;
    this.manual = manual;
    if (!this.manual) {
      this.run();
    }
  }

  run() {
    log('run effect', this);
    this.running = true;
    this.addCurrentEffect();
    this.release();
    this.destroy = this.effectFn();
    this.popCurrentEffect();
    this.updatePriority();
    super.run();
  }

  stop() {
    log('stop effect', this);
    if (this.running) {
      this.destroy && this.destroy();
      this.release();
      this.destroy = null;
      this.running = false;
    }
  }
}

export function createSignal<T>(init: T) {
  return new Signal(init);
}

export function createComputed<T>(fn: () => T) {
  return new Computed(fn);
}

export function createEffect(effect: () => Unsubscribe, manual?: boolean) {
  return new Effect(effect, manual);
}

export function createStore() {}

const num = createSignal(1);

const num2 = createComputed(() => num.value + 1);

createEffect(() => {
  console.log(num.value, num2.value);
});

setInterval(() => {
  num.value = num.value + 1;
}, 3000);
