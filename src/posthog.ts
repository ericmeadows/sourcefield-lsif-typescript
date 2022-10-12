#!/usr/bin/env node
import { PostHog } from 'posthog-node';

export default function emitMetricsToPosthog(
    licenseKey: string | undefined,
    commit: string,
    event: string,
    properties: any,
    client: PostHog
): void {
    if (!licenseKey) {
        console.log('='.repeat(20));
        console.log('The following metrics would be emitted to Posthog');
        console.log('-'.repeat(20));
        console.log(`LICENSE_KEY: ${licenseKey}; (required to be populated to emit)`);
        console.log(`event: ${event}`);
        console.log('properties', properties);
        console.log('='.repeat(20));
    } else {
        client.capture({
            distinctId: commit,
            event: event,
            properties,
        });
    }
}

// print("=" * 20)
// print("The following metrics would be emitted to Posthog")
// print("-" * 20)
// print(
//     f"LICENSE_KEY: {LICENSE_KEY}; (required to be populated to emit)"
// )
// print("event_data", event_data)
// print("=" * 20)
// return
