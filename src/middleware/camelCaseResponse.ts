import { Request, Response, NextFunction } from 'express';

const toCamel = (s: string) => {
  if (s === '_id') return s;
  return s.replace(/([-_][a-z])/ig, ($1) => {
    return $1.toUpperCase()
      .replace('-', '')
      .replace('_', '');
  });
};

const isObject = (o: any) => o === Object(o) && !Array.isArray(o) && typeof o !== 'function' && !(o instanceof Date) && !(o instanceof RegExp);

const keysToCamel = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map((v) => keysToCamel(v));
  } else if (isObject(obj)) {
    return Object.keys(obj).reduce(
      (result, key) => ({
        ...result,
        [toCamel(key)]: keysToCamel(obj[key]),
      }),
      {}
    );
  }
  return obj;
};

export const camelCaseResponse = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  res.json = function (obj) {
    if (obj) {
      obj = keysToCamel(obj);
    }
    return originalJson.call(this, obj);
  };
  next();
};
