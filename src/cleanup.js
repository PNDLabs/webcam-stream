import { readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import cron from 'node-cron';

class Cleanup {
  constructor(config) {
    this.config = config;
    this.cronJob = null;
  }

  start() {
    // Run cleanup every hour at minute 5
    this.cronJob = cron.schedule('5 * * * *', () => {
      this.cleanOldRecordings();
    });

    // Also run immediately on start
    this.cleanOldRecordings();

    console.log(`Cleanup scheduled - removing recordings older than ${this.config.retentionDays} days`);
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  cleanOldRecordings() {
    const outputDir = path.resolve(this.config.outputDir);
    const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    let deletedCount = 0;
    let totalSize = 0;

    try {
      const files = readdirSync(outputDir);

      for (const file of files) {
        if (!file.endsWith('.mp4')) continue;

        const filePath = path.join(outputDir, file);

        try {
          const stats = statSync(filePath);

          if (stats.mtime.getTime() < cutoffTime) {
            totalSize += stats.size;
            unlinkSync(filePath);
            deletedCount++;
            console.log(`Deleted old recording: ${file}`);
          }
        } catch (err) {
          console.error(`Error processing file ${file}:`, err.message);
        }
      }

      if (deletedCount > 0) {
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        console.log(`Cleanup complete: deleted ${deletedCount} files, freed ${sizeMB} MB`);
      }
    } catch (err) {
      console.error('Error during cleanup:', err.message);
    }

    return { deletedCount, totalSize };
  }

  getStorageStats() {
    const outputDir = path.resolve(this.config.outputDir);
    let totalFiles = 0;
    let totalSize = 0;
    let oldestFile = null;
    let newestFile = null;

    try {
      const files = readdirSync(outputDir);

      for (const file of files) {
        if (!file.endsWith('.mp4')) continue;

        const filePath = path.join(outputDir, file);

        try {
          const stats = statSync(filePath);
          totalFiles++;
          totalSize += stats.size;

          if (!oldestFile || stats.mtime < oldestFile.mtime) {
            oldestFile = { name: file, mtime: stats.mtime };
          }
          if (!newestFile || stats.mtime > newestFile.mtime) {
            newestFile = { name: file, mtime: stats.mtime };
          }
        } catch (err) {
          // Skip files that can't be accessed
        }
      }
    } catch (err) {
      console.error('Error getting storage stats:', err.message);
    }

    return {
      totalFiles,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      oldestFile: oldestFile?.name || null,
      newestFile: newestFile?.name || null,
      retentionDays: this.config.retentionDays
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`Cleanup config updated - retention: ${this.config.retentionDays} days`);
  }
}

export default Cleanup;
