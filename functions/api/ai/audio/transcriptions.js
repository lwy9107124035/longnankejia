import { onAudio } from '../../../_lib/siliconflow.js';

export const onRequest = ({ request, env }) => onAudio(request, { env });
