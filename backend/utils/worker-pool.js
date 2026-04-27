const { Worker } = require('worker_threads');
const os = require('os');

class WorkerPool {
  constructor(workerScript, poolSize = os.cpus().length) {
    this.workerScript = workerScript;
    this.poolSize = poolSize;
    this.workers = [];
    this.queue = [];
    this.activeWorkers = 0;
    
    // 初始化工作线程池
    for (let i = 0; i < poolSize; i++) {
      this.workers.push({ worker: null, busy: false });
    }
  }
  
  // 执行任务
  async exec(data) {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.processQueue();
    });
  }
  
  // 处理队列
  processQueue() {
    if (this.queue.length === 0) return;
    
    // 查找空闲的工作线程
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker) return;
    
    const task = this.queue.shift();
    availableWorker.busy = true;
    this.activeWorkers++;
    
    // 创建新的 Worker
    const worker = new Worker(this.workerScript, {
      workerData: task.data
    });
    
    availableWorker.worker = worker;
    
    worker.on('message', (result) => {
      task.resolve(result);
      this.cleanupWorker(availableWorker);
    });
    
    worker.on('error', (error) => {
      task.reject(error);
      this.cleanupWorker(availableWorker);
    });
    
    worker.on('exit', (code) => {
      if (code !== 0) {
        task.reject(new Error(`Worker stopped with exit code ${code}`));
      }
      this.cleanupWorker(availableWorker);
    });
  }
  
  // 清理工作线程
  cleanupWorker(workerSlot) {
    if (workerSlot.worker) {
      workerSlot.worker.terminate();
      workerSlot.worker = null;
    }
    workerSlot.busy = false;
    this.activeWorkers--;
    
    // 继续处理队列
    this.processQueue();
  }
  
  // 销毁线程池
  async destroy() {
    for (const workerSlot of this.workers) {
      if (workerSlot.worker) {
        await workerSlot.worker.terminate();
      }
    }
    this.workers = [];
    this.queue = [];
  }
}

module.exports = WorkerPool;
