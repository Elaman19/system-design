import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function renderResults(report) {
  const errorsLabel =
    report.schemaVersion === 1 ? 'errors + timeouts (legacy)' : 'errors';
  return [
    `Median of ${report.RUNS} runs, ${report.DURATION} s each, ${report.HEAVY_CONN} heavy + ${report.LIGHT_CONN} light connections, Node ${report.node}`,
    '',
    `| Variant | /light RPS | /light p50, ms | /light p99, ms (min–max) | heavy RPS | heavy p99, ms | ${errorsLabel} | timeouts | non2xx | peak RSS, MB |`,
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.results.map(
      (r) =>
        `| ${r.variant} | ${r.lightRps} | ${r.lightP50} | ${r.lightP99} (${r.lightP99Range}) | ${r.heavyRps ?? '-'} | ${r.heavyP99 ?? '-'} | ${r.errors} | ${r.timeouts ?? 'n/a'} | ${r.non2xx ?? 'n/a'} | ${r.peakRssMb} |`,
    ),
  ].join('\n');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(
    renderResults(
      JSON.parse(readFileSync(process.argv[2] ?? 'results.json', 'utf8')),
    ),
  );
}
