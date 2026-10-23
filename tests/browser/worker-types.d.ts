declare const hashwasm: {
    createSHA256(): Promise<{ init(): void; update(bytes: Uint8Array): void; digest(encoding: 'hex'): string }>;
};
