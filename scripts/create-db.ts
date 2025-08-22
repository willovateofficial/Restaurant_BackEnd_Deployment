//scripts/create-db.ts

import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config();

const createDatabase = async () => {
  const url = process.env.DATABASE_URL!;
  const match = url.match(
    /postgresql:\/\/(.*):(.*)@(.*):(\d+)\/(.*)\?schema=(.*)/
  );

  if (!match) {
    console.error("❌ Invalid DATABASE_URL");
    process.exit(1);
  }

  const [_, user, password, host, port, dbName] = match;

  const client = new Client({
    user,
    password,
    host,
    port: parseInt(port),
    database: "postgres",
  });

  try {
    await client.connect();
    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname='${dbName}'`
    );
    if (res.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database "${dbName}" created`);
    } else {
      console.log(`ℹ Database "${dbName}" already exists`);
    }
  } catch (err) {
    console.error("❌ Error creating database", err);
  } finally {
    await client.end();
  }
};

createDatabase();
