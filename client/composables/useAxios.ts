import axios, { type AxiosInstance } from 'axios'

export type AxiosConfig = {
	baseURL: string
	timeout: number
}
export const useAxios = (configs: AxiosConfig | string): AxiosInstance => {
	const baseURL = typeof configs === 'string' ? configs : configs.baseURL
	const timeout = typeof configs === 'string' ? 10000 : configs.timeout
	const instance = axios.create({
		baseURL,
		timeout
	})

	instance.interceptors.response.use(
		response => response,
		error => {
			// You can handle errors globally here
			return Promise.reject(error)
		}
	)

	return instance
}
