import { Module } from '@nestjs/common';
import { AbuseDetectorService } from './abuse-detector.service.js';

@Module({ providers: [AbuseDetectorService] })
export class AbuseDetectorModule {}
