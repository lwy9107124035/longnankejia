import {setTimeout as pause} from 'node:timers/promises';

export function recoverReadRequests(request, {refresh, delay = pause}) {
  let authorizationRefreshed = false;
  return async body => {
    const readOnly = (body.batch || [body]).every(statement => /^SELECT\b/i.test(statement.sql));
    if (!readOnly) return request(body);

    for (let attempt = 0; ; attempt++) {
      let response;
      try { response = await request(body); }
      catch (error) {
        if (attempt >= 2) throw error;
        await delay(1000);
        continue;
      }
      const authorizationDenied = response.success === false && response.errors?.length &&
        response.errors.every(error => error.code === 9109 || error.code === 7403);
      if (!authorizationDenied || authorizationRefreshed) return response;
      authorizationRefreshed = true;
      await refresh();
    }
  };
}
