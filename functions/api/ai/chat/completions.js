import { onChat } from '../../../_lib/siliconflow.js';

export const onRequest = ({ request, env }) => onChat(request, { env });
