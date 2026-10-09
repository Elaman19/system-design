import { config } from 'dotenv';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './config/database.config.js';
import { loadEnv } from './config/env.js';

config({ quiet: true });

export default new DataSource(dataSourceOptions(loadEnv()));
