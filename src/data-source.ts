import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './config/database.config.js';

export default new DataSource(dataSourceOptions());
