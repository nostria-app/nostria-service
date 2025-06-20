
import development from './config.development';
import production from './config.production';
import { Config } from './types';

const config: Config = process.env.NODE_ENV === 'production' ? production : development;

export default config;