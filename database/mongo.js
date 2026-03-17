import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI
  || 'mongodb+srv://rounakmondal198_db_user:WtBrPHpvvHTDN8cV@cluster0.ukl5poj.mongodb.net/?appName=Cluster0';

const DB_NAME = 'interviewsathi';

let client;
let db;

export async function connectMongo() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);

  // Ensure indexes
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('otps').createIndex({ email: 1 });
  await db.collection('otps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('scores').createIndex({ userId: 1, createdAt: -1 });

  console.log('✅ MongoDB connected');
  return db;
}

export function getDb() {
  if (!db) throw new Error('MongoDB not connected. Call connectMongo() first.');
  return db;
}
