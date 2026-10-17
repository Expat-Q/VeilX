import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/xtip";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

let cached: MongooseCache = global.mongooseCache || { conn: null, promise: null };

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((m) => {
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

/**
 * Ensures all collection indexes (especially unique constraints for idempotency and txid anti-replay)
 * are verified and created on database initialization.
 */
export async function ensureDatabaseIndexes(): Promise<void> {
  const db = await connectToDatabase();
  const models = db.models;
  const syncPromises = Object.values(models).map((model) => {
    if (typeof (model as any).syncIndexes === "function") {
      return (model as any).syncIndexes().catch((err: any) => {
        console.warn(`[MongoDB] Warning syncing indexes for ${(model as any).modelName}:`, err.message);
      });
    }
    return Promise.resolve();
  });
  await Promise.all(syncPromises);
}

