import * as dns from 'node:dns';
import * as net from 'node:net';
import {Logger} from 'winston';

/**
 * Matches incoming socket addresses (always IP literals) against a configured
 * cloud_host that may be a hostname (e.g. app.ambientika.eu) or an IP literal.
 * Resolves hostnames once via DNS and caches the result, since the cloud IP
 * can change over time (see #37) while socket comparisons need a plain IP.
 */
export class CloudHostResolver {
    private resolvedIp: string | undefined;

    constructor(private readonly host: string, private readonly log: Logger) {
        if (net.isIP(host)) {
            this.resolvedIp = host;
            return;
        }
        dns.lookup(host, (err, address) => {
            if (err) {
                this.log.warn(`Could not resolve cloud_host "${host}": ${err.message}`);
                return;
            }
            this.log.debug(`Resolved cloud_host "${host}" to ${address}`);
            this.resolvedIp = address;
        });
    }

    matches(address: string): boolean {
        return address === (this.resolvedIp ?? this.host);
    }
}
