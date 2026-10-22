import { Module } from '@nestjs/common';
import { ViewEventsPublisher } from './view-events.publisher.js';

@Module({
  providers: [ViewEventsPublisher],
  exports: [ViewEventsPublisher],
})
export class ClickstreamModule {}
