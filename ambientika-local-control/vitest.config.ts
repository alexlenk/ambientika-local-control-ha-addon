import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/index.ts',
                'src/__tests__/**',
                'src/scripts/**',
                'src/dto/**',
                'src/**/*.interface.ts',
                'src/services/logger.service.ts',
            ],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80
            }
        }
    }
});
