// Takes a script, runs a simple preprocessor that handles macros, includes,
// and transforming literal \t and \n into actual tab and newline characters

export function preprocessScript(script: string): string {
    // Replace literal \t and \n with actual tab and newline characters
    script = script.replace(/\\t/g, "\t").replace(/\\n/g, "\n");

    // TODO: Handle macros and includes

    return script;
}