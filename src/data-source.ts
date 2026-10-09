import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './config/database.config.js';
import { loadEnv } from './config/env.js';

export default new DataSource(dataSourceOptions(loadEnv()));
