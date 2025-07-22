/// <reference types="node" />

import * as events from "events";

declare namespace Ffmpeg {
  class FfmpegCommand extends events.EventEmitter {
    /**
     * Emitted just after ffmpeg has been spawned.
     *
     * @event FfmpegCommand#start
     * @param command ffmpeg command line
     */
    on(event: "start", listener: (command: string, pid: number | null) => void): this;

    /**
     * Emitted when an error happens when preparing or running a command
     *
     * @event FfmpegCommand#error
     * @param error error object, with optional properties 'inputStreamError' / 'outputStreamError' for errors on their respective streams
     * @param stdout ffmpeg stdout, unless outputting to a stream
     * @param stderr ffmpeg stderr
     */
    on(event: "error", listener: (error: Error, stdout: string | null, stderr: string | null, pid: number | null) => void): this;

    /**
     * Emitted when a command finishes processing
     *
     * @event FfmpegCommand#end
     * @param stdout ffmpeg stdout when not outputting to a stream, null otherwise
     * @param stderr ffmpeg stderr
     */
    on(event: "end", listener: (stdout: string | null, stderr: string | null, pid: number | null) => void): this;
  }
}
