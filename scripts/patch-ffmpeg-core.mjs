// FFmpeg exits via an Emscripten exception; repeated CLI calls otherwise leave
// their stack frames behind. Restore the caller's stack on every exit path.
export function patchFFmpegCore(source) {
  for (const name of ['exec', 'ffprobe']) {
    const defaults = name === 'exec' ? 'DEFAULT_ARGS' : 'DEFAULT_ARGS_FFPROBE';
    const symbol = name === 'exec' ? '_ffmpeg' : '_ffprobe';
    const original = `function ${name}(..._args){const args=[...Module["${defaults}"],..._args];try{Module["${symbol}"](args.length,stringsToPtr(args))}catch(e){if(!e.message.startsWith("Aborted")){throw e}}return Module["ret"]}`;
    const replacement = `function ${name}(..._args){const savedStack=stackSave();const args=[...Module["${defaults}"],..._args];try{Module["${symbol}"](args.length,stringsToPtr(args))}catch(e){if(!e.message.startsWith("Aborted")){throw e}}finally{stackRestore(savedStack)}return Module["ret"]}`;
    if (!source.includes(original)) throw new Error(`Unsupported FFmpeg core wrapper: ${name}. Review the stack-restoration patch before upgrading.`);
    source = source.replace(original, replacement);
  }
  return source;
}
