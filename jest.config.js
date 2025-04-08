module.exports = {
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  preset: 'ts-jest',
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  }
};
