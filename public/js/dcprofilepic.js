const DEFAULT_GUILD_ID = '0000000000000000000';
const DEFAULT_CHANNEL_ID = '0000000000000000000';

const params = new URLSearchParams(location.search);
const guild = params.get('guild') || DEFAULT_GUILD_ID;
const channel = params.get('channel') || DEFAULT_CHANNEL_ID;

const streamkitParams = new URLSearchParams({
  icon: 'true',
  online: 'true',
  logo: 'white',
  text_color: '#ffffff',
  text_size: '14',
  text_outline_color: '#000000',
  text_outline_size: '0',
  text_shadow_color: '#000000',
  text_shadow_size: '0',
  bg_color: '#0b1024',
  bg_opacity: '0',
  bg_shadow_color: '#000000',
  bg_shadow_size: '0',
  invite_code: params.get('invite_code') || '',
  limit_speaking: 'true',
  small_avatars: 'false',
  hide_names: params.get('hide_names') || 'false',
  fade_chat: '0',
  streamer_avatar_first: 'false'
});

const iframe = document.getElementById('discordStreamkitFrame');
iframe.src = `https://streamkit.discord.com/overlay/voice/${encodeURIComponent(guild)}/${encodeURIComponent(channel)}?${streamkitParams.toString()}`;
