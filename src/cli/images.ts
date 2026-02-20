import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost } from './api-client.js';

export const buildImagesCommand = () => {
  const images = new Command('images').description('Image processing & templates');

  images
    .command('list <productId>')
    .description('List images for a product')
    .action(async (productId: string, _opts, command) => {
      const spinner = ora('Fetching images...').start();
      try {
        const data = await apiGet(`/api/products/${productId}/images`);
        spinner.stop();
        const imgs = data.images || data.data || [];
        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify(imgs, null, 2));
        } else {
          if (!imgs.length) { console.log('No images found.'); return; }
          for (const img of imgs) {
            console.log(`  ${chalk.cyan(img.id || img.position)} | pos:${img.position} | ${img.src?.slice(0, 60) || '—'}`);
          }
        }
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  images
    .command('process <productId>')
    .description('Process images for a product (background removal, etc.)')
    .option('--template <id>', 'Template to apply')
    .action(async (productId: string, opts, command) => {
      const spinner = ora('Processing images...').start();
      try {
        const body: any = {};
        if (opts.template) body.templateId = opts.template;
        const result = await apiPost(`/api/images/process/${productId}`, body);
        spinner.succeed('Image processing triggered');
        if (command.optsWithGlobals().json) console.log(JSON.stringify(result, null, 2));
        else console.log(`  Processed: ${result.processed ?? '—'} images`);
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  images
    .command('reprocess <productId>')
    .description('Reprocess all images for a product')
    .action(async (productId: string, _opts, command) => {
      const spinner = ora('Reprocessing all images...').start();
      try {
        const result = await apiPost(`/api/products/${productId}/images/reprocess-all`);
        spinner.succeed('Reprocessing triggered');
        if (command.optsWithGlobals().json) console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  images
    .command('templates')
    .description('List available photo templates')
    .option('--category <cat>', 'Filter by category')
    .action(async (opts, command) => {
      const spinner = ora('Fetching templates...').start();
      try {
        const params: Record<string, string> = {};
        if (opts.category) params.category = opts.category;
        const data = await apiGet('/api/templates', params);
        spinner.stop();
        const templates = data.data || data.templates || data;
        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify(templates, null, 2));
        } else {
          if (!Array.isArray(templates) || !templates.length) { console.log('No templates found.'); return; }
          console.log(chalk.bold('Templates:'));
          for (const t of templates) {
            const def = t.isDefault ? chalk.green(' [default]') : '';
            console.log(`  ${chalk.cyan(t.id)} | ${t.name}${def} | ${t.category || '—'}`);
          }
        }
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  images
    .command('set-template <templateId>')
    .description('Set a template as default for its category')
    .action(async (templateId: string, _opts, command) => {
      const spinner = ora('Setting default template...').start();
      try {
        const result = await apiPost(`/api/templates/${templateId}/set-default`);
        spinner.succeed(`Template ${templateId} set as default`);
        if (command.optsWithGlobals().json) console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  images
    .command('status')
    .description('Image service status')
    .action(async (_opts, command) => {
      try {
        const data = await apiGet('/api/images/status');
        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.bold('Image Service Status:'));
          for (const [k, v] of Object.entries(data)) {
            console.log(`  ${k}: ${v}`);
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  return images;
};
