export const retry = async (fn, options) => {
    const factor = options.factor ?? 2;
    let attempt = 0;
    let delay = options.delayMs;
    while (true) {
        try {
            return await fn();
        }
        catch (error) {
            attempt += 1;
            if (attempt > options.retries)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= factor;
        }
    }
};
