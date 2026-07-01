import { app } from './app';
import { env } from './config/env';

app.listen(env.port, () => {
  console.log(`API_Mymangaonline running on port ${env.port}`);
});
