import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module.js';
import { ArchiverService } from './archiver.service.js';

@Module({ imports: [S3Module], providers: [ArchiverService] })
export class ArchiverModule {}
